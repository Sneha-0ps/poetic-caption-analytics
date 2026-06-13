const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const queueManager = require('./queue');
const processCaptionJob = require('./worker');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS — allow Vercel frontend + localhost dev ──────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  // Accept ANY vercel.app subdomain automatically
  /https:\/\/.*\.vercel\.app$/,
  // Also accept your exact Vercel URL if you have a custom domain
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some(o =>
      o instanceof RegExp ? o.test(origin) : o === origin
    );
    if (allowed) return callback(null, true);
    console.warn(`CORS blocked: ${origin}`);
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Handle preflight for all routes
app.options('*', cors());

app.use(express.json());

// ── Uploads ───────────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ── Health check (proves the server is reachable) ─────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', message: 'get_social API is running' }));

// ── Auth Routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required" });
  try {
    const passwordHash = `hashed_${password}_secret`;
    const user = await db.createUser(username, passwordHash);
    res.status(201).json({
      message: "User registered successfully",
      token: `mock_jwt_token_${user._id}`,
      user: { id: user._id, username: user.username }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required" });
  try {
    const user = await db.getUserByUsername(username);
    if (!user || user.passwordHash !== `hashed_${password}_secret`)
      return res.status(401).json({ error: "Invalid username or password" });
    res.status(200).json({
      message: "Login successful",
      token: `mock_jwt_token_${user._id}`,
      user: { id: user._id, username: user.username }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth Helper ───────────────────────────────────────────────────────────────
function getUserIdFromReq(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer mock_jwt_token_'))
    return authHeader.split('_token_')[1];
  return 'usr_demo123';
}

// ── Post Routes ───────────────────────────────────────────────────────────────
app.post('/api/posts/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image file is required" });
  const userId = getUserIdFromReq(req);
  const imageUrl = `${process.env.BACKEND_URL || `http://localhost:${PORT}`}/uploads/${req.file.filename}`;
  const imagePath = req.file.path;
  try {
    const post = await db.createPost(userId, imageUrl);
    await queueManager.addJob('caption_job', { postId: post._id, imageUrl, imagePath, userId });
    res.status(202).json({ message: "Uploaded.", postId: post._id, imageUrl, status: "processing" });
  } catch (err) {
    console.error("❌ Upload failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts', async (req, res) => {
  const userId = getUserIdFromReq(req);
  try {
    res.status(200).json(await db.getPostsByUser(userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const post = await db.getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    let statusDetail = post.status;
    if (statusDetail === 'processing') {
      const jobStatus = queueManager.getJobStatus(post._id);
      if (jobStatus?.status === 'failed') {
        statusDetail = 'failed';
        await db.updatePost(post._id, { status: 'failed' });
      }
    }
    res.status(200).json({ ...post, status: statusDetail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/publish', async (req, res) => {
  try {
    const post = await db.getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.status !== 'completed')
      return res.status(400).json({ error: "Only completed posts can be published" });
    const score = post.analytics?.predictedScore || 75;
    const totalEngagement = score + Math.floor((Math.random() - 0.2) * 30);
    const likes  = Math.max(Math.floor(totalEngagement * 0.8), 5);
    const shares = Math.max(Math.floor(totalEngagement * 0.2), 1);
    const updated = await db.updatePost(post._id, {
      analytics: { predictedScore: score, actualLikes: likes, actualShares: shares }
    });
    res.status(200).json({ message: "Post published!", post: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.get('/api/analytics', async (req, res) => {
  const userId = getUserIdFromReq(req);
  try {
    const posts = await db.getPostsByUser(userId);
    const activePosts = posts.filter(p =>
      p.status === 'completed' && (p.analytics.actualLikes > 0 || p.analytics.actualShares > 0)
    );
    const timelineData = activePosts
      .map(p => ({
        date: new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        likes: p.analytics.actualLikes, shares: p.analytics.actualShares,
        predicted: p.analytics.predictedScore, rawDate: new Date(p.createdAt)
      }))
      .sort((a, b) => a.rawDate - b.rawDate);

    const tagStats = {};
    activePosts.forEach(p => {
      const engagement = (p.analytics?.actualLikes || 0) + 2 * (p.analytics?.actualShares || 0);
      (p.content?.moodTags || []).forEach(tag => {
        const t = tag.toLowerCase().trim();
        if (!tagStats[t]) tagStats[t] = { count: 0, totalEngagement: 0 };
        tagStats[t].count++;
        tagStats[t].totalEngagement += engagement;
      });
    });
    const tagData = Object.keys(tagStats)
      .map(tag => ({ tag, avgEngagement: Math.round(tagStats[tag].totalEngagement / tagStats[tag].count), count: tagStats[tag].count }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);

    const totalLikes  = activePosts.reduce((a, p) => a + p.analytics.actualLikes, 0);
    const totalShares = activePosts.reduce((a, p) => a + p.analytics.actualShares, 0);
    const totalActual = activePosts.reduce((a, p) => a + p.analytics.actualLikes + 2 * p.analytics.actualShares, 0);
    let totalError = 0;
    activePosts.forEach(p => {
      totalError += Math.abs(p.analytics.predictedScore - (p.analytics.actualLikes + 2 * p.analytics.actualShares));
    });

    res.status(200).json({
      timeline: timelineData,
      tags: tagData.slice(0, 8),
      stats: {
        totalPosts: posts.length,
        completedPosts: posts.filter(p => p.status === 'completed').length,
        avgLikes: activePosts.length > 0 ? Math.round(totalLikes / activePosts.length) : 0,
        totalLikes, totalShares,
        accuracyPercent: activePosts.length > 0
          ? Math.max(0, Math.round(100 - (totalError / (totalActual || 1)) * 100))
          : 100
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function startServer() {
  await db.connectDB();
  queueManager.initializeQueue(processCaptionJob);
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Uploads available at http://localhost:${PORT}/uploads/`);
  });
}
startServer();
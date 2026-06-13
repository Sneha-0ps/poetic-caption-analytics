const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const db = require('./db');
const queueManager = require('./queue');
const processCaptionJob = require('./worker');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// ── Cloudinary config ─────────────────────────────────────────────────────────
if (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log("☁️  Cloudinary configured.");
} else {
  console.warn("⚠️  No Cloudinary credentials. Images will use local storage (not suitable for production).");
}

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  /https:\/\/.*\.vercel\.app$/,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
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

app.options(/.*/, cors());
app.use(express.json());

// ── Local uploads fallback (dev only) ─────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer stores to memory (works on Render — no disk dependency)
const upload = multer({ storage: multer.memoryStorage() });

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.json({ status: 'ok', message: 'get_social API is running' })
);

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required" });
  try {
    const user = await db.createUser(username, `hashed_${password}_secret`);
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

function getUserIdFromReq(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer mock_jwt_token_'))
    return authHeader.split('_token_')[1];
  return 'usr_demo123';
}

// ── Upload — stores to Cloudinary, falls back to disk ─────────────────────────
app.post('/api/posts/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image file is required" });
  const userId = getUserIdFromReq(req);

  try {
    let imageUrl;

    const hasCloudinary = process.env.CLOUDINARY_CLOUD_NAME &&
                          process.env.CLOUDINARY_API_KEY &&
                          process.env.CLOUDINARY_API_SECRET;

    if (hasCloudinary) {
      // Upload buffer directly to Cloudinary (no temp file needed)
      console.log("[Server] Uploading image to Cloudinary...");
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'get_social', resource_type: 'image' },
          (error, result) => error ? reject(error) : resolve(result)
        );
        stream.end(req.file.buffer);
      });
      imageUrl = uploadResult.secure_url;
      console.log("[Server] Cloudinary upload success:", imageUrl);
    } else {
      // Fallback: save to local disk (dev only)
      const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) +
                       path.extname(req.file.originalname);
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, req.file.buffer);
      imageUrl = `${process.env.BACKEND_URL || `http://localhost:${PORT}`}/uploads/${filename}`;
      console.log("[Server] Saved to local disk:", imageUrl);
    }

    const post = await db.createPost(userId, imageUrl);
    await queueManager.addJob('caption_job', {
      postId: post._id,
      imageUrl,   // permanent Cloudinary URL — worker fetches this
      imagePath: null,
      userId
    });

    res.status(202).json({
      message: "Uploaded. Analysis job dispatched.",
      postId: post._id, imageUrl, status: "processing"
    });
  } catch (err) {
    console.error("❌ Upload failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Posts ─────────────────────────────────────────────────────────────────────
app.get('/api/posts', async (req, res) => {
  const userId = getUserIdFromReq(req);
  try { res.status(200).json(await db.getPostsByUser(userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:id/publish', async (req, res) => {
  try {
    const post = await db.getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.status !== 'completed')
      return res.status(400).json({ error: "Only completed posts can be published" });
    const score = post.analytics?.predictedScore || 75;
    const total = score + Math.floor((Math.random() - 0.2) * 30);
    const updated = await db.updatePost(post._id, {
      analytics: {
        predictedScore: score,
        actualLikes:  Math.max(Math.floor(total * 0.8), 5),
        actualShares: Math.max(Math.floor(total * 0.2), 1)
      }
    });
    res.status(200).json({ message: "Post published!", post: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.get('/api/analytics', async (req, res) => {
  const userId = getUserIdFromReq(req);
  try {
    const posts = await db.getPostsByUser(userId);
    const active = posts.filter(p =>
      p.status === 'completed' && (p.analytics.actualLikes > 0 || p.analytics.actualShares > 0)
    );
    const timeline = active
      .map(p => ({
        date: new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        likes: p.analytics.actualLikes, shares: p.analytics.actualShares,
        predicted: p.analytics.predictedScore, rawDate: new Date(p.createdAt)
      }))
      .sort((a, b) => a.rawDate - b.rawDate);

    const tagStats = {};
    active.forEach(p => {
      const eng = (p.analytics?.actualLikes || 0) + 2 * (p.analytics?.actualShares || 0);
      (p.content?.moodTags || []).forEach(tag => {
        const t = tag.toLowerCase().trim();
        if (!tagStats[t]) tagStats[t] = { count: 0, total: 0 };
        tagStats[t].count++; tagStats[t].total += eng;
      });
    });
    const tags = Object.keys(tagStats)
      .map(t => ({ tag: t, avgEngagement: Math.round(tagStats[t].total / tagStats[t].count), count: tagStats[t].count }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .slice(0, 8);

    const totalLikes  = active.reduce((a, p) => a + p.analytics.actualLikes, 0);
    const totalShares = active.reduce((a, p) => a + p.analytics.actualShares, 0);
    const totalActual = active.reduce((a, p) => a + p.analytics.actualLikes + 2 * p.analytics.actualShares, 0);
    const totalError  = active.reduce((a, p) => a + Math.abs(p.analytics.predictedScore - (p.analytics.actualLikes + 2 * p.analytics.actualShares)), 0);

    res.status(200).json({
      timeline, tags,
      stats: {
        totalPosts: posts.length,
        completedPosts: posts.filter(p => p.status === 'completed').length,
        avgLikes: active.length > 0 ? Math.round(totalLikes / active.length) : 0,
        totalLikes, totalShares,
        accuracyPercent: active.length > 0
          ? Math.max(0, Math.round(100 - (totalError / (totalActual || 1)) * 100))
          : 100
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

async function startServer() {
  await db.connectDB();
  queueManager.initializeQueue(processCaptionJob);
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}
startServer();
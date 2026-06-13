const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const db = require('./db');
const processCaptionJob = require('./worker');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// ── Cloudinary ────────────────────────────────────────────────────────────────
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log("☁️  Cloudinary configured.");
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
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options(/.*/, cors());
app.use(express.json());

// ── Local uploads fallback ────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// Memory storage — no disk needed
const upload = multer({ storage: multer.memoryStorage() });

// ── Health ────────────────────────────────────────────────────────────────────
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
      token: `mock_jwt_token_${user._id}`,
      user: { id: user._id, username: user.username }
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
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
      token: `mock_jwt_token_${user._id}`,
      user: { id: user._id, username: user.username }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function getUserIdFromReq(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer mock_jwt_token_'))
    return auth.split('_token_')[1];
  return 'usr_demo123';
}

// ── Upload — synchronous processing (no queue, works on free Render) ──────────
app.post('/api/posts/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image file is required" });
  const userId = getUserIdFromReq(req);

  try {
    // 1. Upload image to Cloudinary (permanent URL)
    let imageUrl;
    const hasCloudinary = process.env.CLOUDINARY_CLOUD_NAME &&
                          process.env.CLOUDINARY_API_KEY &&
                          process.env.CLOUDINARY_API_SECRET;
    if (hasCloudinary) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'get_social', resource_type: 'image' },
          (err, res) => err ? reject(err) : resolve(res)
        );
        stream.end(req.file.buffer);
      });
      imageUrl = result.secure_url;
      console.log("[Server] Cloudinary upload:", imageUrl);
    } else {
      const filename = Date.now() + path.extname(req.file.originalname);
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
      imageUrl = `${process.env.BACKEND_URL || `http://localhost:${PORT}`}/uploads/${filename}`;
    }

    // 2. Create post record with processing status
    const post = await db.createPost(userId, imageUrl);

    // 3. Return immediately so frontend starts showing the stepper
    //    Then process in background using setImmediate (non-blocking)
    res.status(202).json({
      message: "Image uploaded. Processing started.",
      postId: post._id,
      imageUrl,
      status: "processing"
    });

    // 4. Process AFTER response is sent — avoids Render request timeout
    // Small delay before starting so the 202 response is fully sent
    setTimeout(async () => {
      try {
        console.log(`[Server] Starting background processing for ${post._id}`);
        await processCaptionJob({
          data: { postId: post._id, imageUrl, imagePath: null, userId }
        });
        console.log(`[Server] Processing complete for ${post._id}`);
      } catch (err) {
        console.error(`[Server] Processing failed for ${post._id}:`, err.message);
        try { await db.updatePost(post._id, { status: 'failed' }); } catch {}
      }
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
    // Race condition guard: if completed but content not yet written, keep polling
    if (post.status === "completed" && (!post.content?.variations?.length)) {
      return res.status(200).json({ ...post, status: "processing" });
    }
    res.status(200).json(post);
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
        likes: p.analytics.actualLikes,
        shares: p.analytics.actualShares,
        predicted: p.analytics.predictedScore,
        rawDate: new Date(p.createdAt)
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
      .sort((a, b) => b.avgEngagement - a.avgEngagement).slice(0, 8);

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
  // No queue needed anymore
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}
startServer();


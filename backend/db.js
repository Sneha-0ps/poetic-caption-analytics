const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('./models/User');
const Post = require('./models/Post');

const JSON_DB_FILE = path.join(__dirname, 'local_database_fallback.json');
let useLocalDb = false;

function initLocalDb() {
  if (!fs.existsSync(JSON_DB_FILE)) {
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify({ users: [], posts: [] }, null, 2));
  }
}

function readLocalDb() {
  initLocalDb();
  try {
    return JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf8'));
  } catch (err) {
    console.error("Error reading fallback JSON database, resetting:", err);
    return { users: [], posts: [] };
  }
}

function writeLocalDb(data) {
  try {
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error writing fallback JSON database:", err);
  }
}

const dbManager = {
  connectDB: async () => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.log("⚠️  No MONGODB_URI found. Falling back to local JSON database:", JSON_DB_FILE);
      useLocalDb = true;
      initLocalDb();
      return;
    }
    try {
      console.log("Mongo URI exists:", !!process.env.MONGODB_URI);
      await mongoose.connect(mongoUri);
      console.log("⚙️  MongoDB connected successfully.");
      useLocalDb = false;
    } catch (err) {
      console.error("❌ MongoDB connection failed. Falling back to local JSON database:", err.message);
      useLocalDb = true;
      initLocalDb();
    }
  },

  isLocal: () => useLocalDb,

  // ── User Actions ────────────────────────────────────────────────────────────

  createUser: async (username, passwordHash) => {
    if (useLocalDb) {
      const db = readLocalDb();
      const existing = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (existing) throw new Error("Username already taken");
      const newUser = {
        _id: 'usr_' + Math.random().toString(36).substr(2, 9),
        username: username.toLowerCase(),
        passwordHash,
        createdAt: new Date().toISOString()
      };
      db.users.push(newUser);
      writeLocalDb(db);
      return newUser;
    } else {
      const user = new User({ username, passwordHash });
      return await user.save();
    }
  },

  getUserByUsername: async (username) => {
    if (useLocalDb) {
      const db = readLocalDb();
      return db.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
    } else {
      return await User.findOne({ username: username.toLowerCase() });
    }
  },

  // ── Post Actions ────────────────────────────────────────────────────────────

  createPost: async (userId, imageUrl) => {
    if (useLocalDb) {
      const db = readLocalDb();
      const newPost = {
        _id: 'post_' + Math.random().toString(36).substr(2, 9),
        userId,
        imageUrl,
        status: 'processing',
        content: { moodTags: [], poeticCaption: '', variations: [] },
        analytics: { predictedScore: 0, actualLikes: 0, actualShares: 0 },
        createdAt: new Date().toISOString()
      };
      db.posts.push(newPost);
      writeLocalDb(db);
      return newPost;
    } else {
      const post = new Post({ userId, imageUrl, status: 'processing' });
      return await post.save();
    }
  },

  getPostById: async (id) => {
    if (useLocalDb) {
      const db = readLocalDb();
      return db.posts.find(p => p._id === id) || null;
    } else {
      return await Post.findById(id).lean();
    }
  },

  getPostsByUser: async (userId) => {
    if (useLocalDb) {
      const db = readLocalDb();
      return db.posts
        .filter(p => p.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      return await Post.find({ userId }).sort({ createdAt: -1 }).lean();
    }
  },

  getAllPosts: async () => {
    if (useLocalDb) {
      return readLocalDb().posts;
    } else {
      return await Post.find({}).lean();
    }
  },

  updatePost: async (id, updateData) => {
    if (useLocalDb) {
      const db = readLocalDb();
      const idx = db.posts.findIndex(p => p._id === id);
      if (idx === -1) throw new Error("Post not found");
      db.posts[idx] = {
        ...db.posts[idx],
        ...updateData,
        content: updateData.content
          ? { ...db.posts[idx].content, ...updateData.content }
          : db.posts[idx].content,
        analytics: updateData.analytics
          ? { ...db.posts[idx].analytics, ...updateData.analytics }
          : db.posts[idx].analytics
      };
      writeLocalDb(db);
      return db.posts[idx];
    } else {
      return await Post.findByIdAndUpdate(id, updateData, { new: true }).lean();
    }
  },

  seedPosts: async (posts) => {
    if (useLocalDb) {
      const db = readLocalDb();
      db.posts = [
        ...db.posts.filter(p => !p._id.startsWith('seed_')),
        ...posts.map((p, i) => ({
          _id: 'seed_' + i,
          ...p,
          createdAt: p.createdAt || new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString()
        }))
      ];
      writeLocalDb(db);
      console.log(`Seeded ${posts.length} posts to local JSON database.`);
    } else {
      await Post.deleteMany({ _id: { $regex: /^seed_/ } });
      const seeded = posts.map(() => ({ _id: new mongoose.Types.ObjectId(), ...posts }));
      await Post.insertMany(seeded);
      console.log(`Seeded ${posts.length} posts to MongoDB.`);
    }
  }
};

module.exports = dbManager;
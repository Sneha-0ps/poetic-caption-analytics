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
  try { return JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf8')); }
  catch { return { users: [], posts: [] }; }
}

function writeLocalDb(data) {
  try { fs.writeFileSync(JSON_DB_FILE, JSON.stringify(data, null, 2)); }
  catch (err) { console.error("Error writing local DB:", err); }
}

const dbManager = {
  connectDB: async () => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.log("⚠️  No MONGODB_URI found. Using local JSON database.");
      useLocalDb = true; initLocalDb(); return;
    }
    console.log("Mongo URI exists: true");
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 8000,   // fail fast — don't hang for 30s
        connectTimeoutMS: 10000,
        socketTimeoutMS: 30000,
        // Required for Atlas SRV on some networks:
        family: 4,                         // force IPv4 (avoids IPv6 DNS issues)
      });
      console.log("⚙️  MongoDB connected successfully.");
      useLocalDb = false;
    } catch (err) {
      console.error("❌ MongoDB connection failed. Falling back to local JSON database:", err.message);

      // Helpful hints for the most common Atlas errors
      if (err.message.includes('querySrv') || err.message.includes('ECONNREFUSED')) {
        console.error("💡 Hint: Atlas SRV DNS lookup failed.");
        console.error("   → Whitelist 0.0.0.0/0 in Atlas → Network Access");
        console.error("   → Or check if your ISP/firewall blocks port 27017");
        console.error("   → Try replacing 'mongodb+srv://' with 'mongodb://' and port 27017 if SRV keeps failing");
      }
      if (err.message.includes('Authentication') || err.message.includes('bad auth')) {
        console.error("💡 Hint: Wrong username/password in MONGODB_URI");
      }

      useLocalDb = true; initLocalDb();
    }
  },

  isLocal: () => useLocalDb,

  // ── User Actions ──────────────────────────────────────────────────────────

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
      return await User.findOne({ username: username.toLowerCase() }).lean();
    }
  },

  // ── Post Actions ──────────────────────────────────────────────────────────

  createPost: async (userId, imageUrl) => {
    if (useLocalDb) {
      const db = readLocalDb();
      const newPost = {
        _id: 'post_' + Math.random().toString(36).substr(2, 9),
        userId, imageUrl, status: 'processing',
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
      return readLocalDb().posts.find(p => p._id === id) || null;
    } else {
      return await Post.findById(id).lean();
    }
  },

  getPostsByUser: async (userId) => {
    if (useLocalDb) {
      const db = readLocalDb();
      return db.posts.filter(p => p.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      return await Post.find({ userId }).sort({ createdAt: -1 }).lean();
    }
  },

  getAllPosts: async () => {
    if (useLocalDb) return readLocalDb().posts;
    else return await Post.find({}).lean();
  },

  updatePost: async (id, updateData) => {
    if (useLocalDb) {
      const db = readLocalDb();
      const idx = db.posts.findIndex(p => p._id === id);
      if (idx === -1) throw new Error("Post not found");
      db.posts[idx] = {
        ...db.posts[idx], ...updateData,
        content:   updateData.content   ? { ...db.posts[idx].content,   ...updateData.content   } : db.posts[idx].content,
        analytics: updateData.analytics ? { ...db.posts[idx].analytics, ...updateData.analytics } : db.posts[idx].analytics
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
          _id: 'seed_' + i, ...p,
          createdAt: p.createdAt || new Date(Date.now() - i * 86400000).toISOString()
        }))
      ];
      writeLocalDb(db);
      console.log(`Seeded ${posts.length} posts to local JSON database.`);
    } else {
      await Post.deleteMany({ _id: { $regex: /^seed_/ } });
      await Post.insertMany(posts.map(p => ({ _id: new mongoose.Types.ObjectId(), ...p })));
      console.log(`Seeded ${posts.length} posts to MongoDB.`);
    }
  }
};

module.exports = dbManager;
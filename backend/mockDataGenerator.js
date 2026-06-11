const axios = require('axios');
const db = require('./db');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const MOCK_TAGS = ['vintage', 'romantic', 'melancholy', 'minimalist', 'serene', 'peaceful', 'adventure', 'nature', 'cozy', 'nostalgic', 'urban', 'neon', 'cyberpunk', 'retro', 'aesthetic'];
const CAPTIONS = [
  "Whispers of autumn trapped in a silver frame...",
  "Silence speaks volumes when the world goes quiet.",
  "Lost in the wilderness, yet finding where I belong.",
  "Raindrops on the pane and coffee in hand, time stands still.",
  "Concrete giants echoing the electric hum of the night.",
  "Chasing the golden hour until it fades to memory.",
  "90s cinematic aesthetics. ✨",
  "Warm cups, old records, and quiet conversations.",
  "Finding magic in the mundane details of today.",
  "Looking back at paths we didn't take.",
  "Under the neon lights, we are all just shadows.",
  "A quiet heart in a loud city. 🏙️",
  "Where the forest meets the sky, my soul breathes.",
  "Coffee, cozy sweaters, and late-night thoughts.",
  "Retro frames, modern dreams.",
  "Dancing through the silver mist of the morning.",
  "An empty bench, a full heart, and a setting sun.",
  "Electric vibes in the city that never sleeps. ⚡",
  "Collect memories, leave only footprints. 🌲",
  "Sipping on nostalgia under a warm blanket."
];
// Helper to generate a random item from array
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Generate correlated engagement metrics based on features
// So the Python ML model actually has patterns to learn!
function calculateMockEngagement(caption, tags) {
  let baseLikes = 50;
  let baseShares = 10;
  // Correlation 1: Length is sweet at 40-100 characters
  const len = caption.length;
  if (len >= 40 && len <= 100) {
    baseLikes += 45;
    baseShares += 15;
  } else {
    baseLikes -= Math.abs(70 - len) * 0.3;
    baseShares -= Math.abs(70 - len) * 0.05;
  }
  // Correlation 2: Popular tags get higher engagement
  const popularTags = ['vintage', 'neon', 'adventure', 'cozy', 'aesthetic'];
  tags.forEach(tag => {
    if (popularTags.includes(tag.toLowerCase())) {
      baseLikes += 25;
      baseShares += 8;
    }
  });
  // Correlation 3: Emojis increase engagement
  const hasEmoji = /[\uD800-\uDFFF\u2600-\u27BF]/.test(caption) || caption.includes('✨') || caption.includes('🌲') || caption.includes('🏙️') || caption.includes('☕') || caption.includes('⚡');
  if (hasEmoji) {
    baseLikes += 20;
    baseShares += 6;
  }
  // Add some random noise
  const noiseLikes = Math.floor((Math.random() - 0.5) * 20);
  const noiseShares = Math.floor((Math.random() - 0.5) * 5);
  const likes = Math.max(Math.floor(baseLikes + noiseLikes), 5);
  const shares = Math.max(Math.floor(baseShares + noiseShares), 1);
  const predictedScore = likes + 2 * shares + Math.floor((Math.random() - 0.5) * 10);
  return {
    likes,
    shares,
    predictedScore: Math.max(predictedScore, 5)
  };
}
async function runSeeder() {
  await db.connectDB();
  
  console.log("Generating 60 mock historical posts...");
  const posts = [];
  
  for (let i = 0; i < 60; i++) {
    const caption = randomItem(CAPTIONS);
    
    // Choose 2-3 random tags
    const tagsCount = Math.floor(Math.random() * 2) + 2; // 2 or 3 tags
    const postTags = [];
    while (postTags.length < tagsCount) {
      const tag = randomItem(MOCK_TAGS);
      if (!postTags.includes(tag)) {
        postTags.push(tag);
      }
    }
    
    const { likes, shares, predictedScore } = calculateMockEngagement(caption, postTags);
    
    // Random date in the last 30 days
    const postDate = new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000);
    posts.push({
      userId: 'usr_demo123',
      imageUrl: `https://picsum.photos/id/${Math.floor(Math.random() * 50) + 10}/800/600`,
      status: 'completed',
      content: {
        moodTags: postTags,
        poeticCaption: caption,
        variations: [
          { moodTags: postTags, poeticCaption: caption, predictedScore, isBest: true },
          { moodTags: [postTags[0]], poeticCaption: "Alt caption detail...", predictedScore: Math.max(predictedScore - 20, 10), isBest: false }
        ]
      },
      analytics: {
        predictedScore,
        actualLikes: likes,
        actualShares: shares
      },
      createdAt: postDate.toISOString()
    });
  }
  try {
    await db.seedPosts(posts);
    
    // Call Python Microservice to train model with the newly generated posts
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';
    console.log(`Notifying Python analytics service to train on new data at ${pythonServiceUrl}/train...`);
    
    // Pass training posts to flask
    const trainingPosts = posts.map(p => ({
      moodTags: p.content.moodTags,
      poeticCaption: p.content.poeticCaption,
      likes: p.analytics.actualLikes,
      shares: p.analytics.actualShares
    }));
    const trainRes = await axios.post(`${pythonServiceUrl}/train`, { posts: trainingPosts });
    console.log("Python training response:", trainRes.data);
    
    console.log("Seeding complete! Database has been populated and predictive model trained.");
  } catch (err) {
    console.error("❌ Seeding failed:", err.message);
  } finally {
    if (!db.isLocal()) {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
    }
    process.exit(0);
  }
}
// Only run if executed directly
if (require.main === module) {
  runSeeder();
}
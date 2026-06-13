const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./db');

const MOCK_AI_RESPONSES = [
  {
    mood_tags: ["vintage", "romantic", "melancholy"],
    poetic_caption: "Whispers of autumn trapped in a silver frame...",
    short_captions: ["90s cinematic aesthetics. ✨", "Chasing golden hour memories."]
  },
  {
    mood_tags: ["minimalist", "serene", "peaceful"],
    poetic_caption: "Silence speaks volumes when the world goes quiet.",
    short_captions: ["Clean lines, quiet minds. 🤍", "Finding beauty in simplicity."]
  },
  {
    mood_tags: ["adventure", "wanderlust", "nature"],
    poetic_caption: "Lost in the wilderness, yet finding where I belong.",
    short_captions: ["Into the wild we go. 🌲", "Collect moments, not things."]
  },
  {
    mood_tags: ["cozy", "nostalgic", "warmth"],
    poetic_caption: "Raindrops on the pane and coffee in hand, time stands still.",
    short_captions: ["Vibing with rainy days. ☕", "Warm cups & old records."]
  },
  {
    mood_tags: ["urban", "neon", "cyberpunk"],
    poetic_caption: "Concrete giants echoing the electric hum of the night.",
    short_captions: ["City lights and neon dreams. ⚡", "Lost in the rush."]
  },
  {
    mood_tags: ["joyful", "candid", "lifestyle"],
    poetic_caption: "A genuine smile is the prettiest thing you can wear.",
    short_captions: ["Just being me. 😊", "Good vibes only. ✌️"]
  },
  {
    mood_tags: ["foodie", "indulgent", "aesthetic"],
    poetic_caption: "Every bite tells a story of love and craft.",
    short_captions: ["Eat well, live well. 🍝", "Food is my love language. ❤️"]
  }
];

async function callGeminiAPI(imagePath, imageUrl) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log("[Worker] No GEMINI_API_KEY. Using mock AI generation.");
    await new Promise(resolve => setTimeout(resolve, 1500));
    return MOCK_AI_RESPONSES[Math.floor(Math.random() * MOCK_AI_RESPONSES.length)];
  }

  console.log(`[Worker] Calling Gemini API...`);

  // Try reading from disk first (works locally), fall back to fetching via URL (works on Render)
  let base64Image = null;
  let mimeType = 'image/jpeg';

  // Determine mime type from path or URL
  const src = imagePath || imageUrl || '';
  if (src.endsWith('.png'))  mimeType = 'image/png';
  if (src.endsWith('.webp')) mimeType = 'image/webp';

  // 1. Try local file
  if (imagePath && fs.existsSync(imagePath)) {
    try {
      base64Image = fs.readFileSync(imagePath).toString('base64');
      console.log("[Worker] Image loaded from local disk.");
    } catch (e) {
      console.warn("[Worker] Could not read local file:", e.message);
    }
  }

  // 2. Fall back to fetching the image via HTTP (required on Render/deployed servers)
  if (!base64Image && imageUrl) {
    try {
      console.log("[Worker] Fetching image via HTTP URL...");
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      base64Image = Buffer.from(response.data).toString('base64');
      // Detect mime type from content-type header if available
      const ct = response.headers['content-type'];
      if (ct) mimeType = ct.split(';')[0].trim();
      console.log("[Worker] Image fetched via HTTP successfully.");
    } catch (e) {
      console.warn("[Worker] Could not fetch image via URL:", e.message);
    }
  }

  // 3. If we still have no image data, use mock
  if (!base64Image) {
    console.warn("[Worker] Could not load image by any method. Using mock response.");
    return MOCK_AI_RESPONSES[Math.floor(Math.random() * MOCK_AI_RESPONSES.length)];
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [{
        parts: [
          {
            text: `Analyze this image and return a JSON object with:
1. mood_tags: Array of 3-4 evocative mood/style keywords.
2. poetic_caption: A beautiful, slightly longer, poetic caption matching the image mood.
3. short_captions: Array of 2 punchy, short social-media captions (including emojis).`
          },
          {
            inlineData: { mimeType, data: base64Image }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            mood_tags:      { type: "array", items: { type: "string" } },
            poetic_caption: { type: "string" },
            short_captions: { type: "array", items: { type: "string" } }
          },
          required: ["mood_tags", "poetic_caption", "short_captions"]
        }
      }
    };

    const response = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) throw new Error("Empty response from Gemini API");
    return JSON.parse(responseText);

  } catch (err) {
    console.error("❌ Gemini API failed:", err.message);
    if (err.response) console.error("Gemini detail:", JSON.stringify(err.response.data));
    console.log("[Worker] Falling back to mock response.");
    return MOCK_AI_RESPONSES[Math.floor(Math.random() * MOCK_AI_RESPONSES.length)];
  }
}

async function processCaptionJob(job) {
  const { postId, imageUrl, imagePath } = job.data;
  console.log(`[Worker] Processing job for post ${postId}...`);

  try {
    await db.updatePost(postId, { status: 'processing' });

    // Pass both imagePath AND imageUrl — worker will use whichever works
    const aiOutput = await callGeminiAPI(imagePath, imageUrl);
    const { mood_tags, poetic_caption, short_captions } = aiOutput;

    const variations = [
      { moodTags: mood_tags,                                        poeticCaption: poetic_caption },
      { moodTags: [mood_tags[0] || 'aesthetic', 'daily'],          poeticCaption: short_captions[0] || "Chasing moments." },
      { moodTags: [mood_tags[1] || 'vibes', mood_tags[2] || 'mood'], poeticCaption: short_captions[1] || "Just living." }
    ];

    // Call Python microservice if available
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';
    let predictionData = {
      predictions: variations.map((v, i) => ({ ...v, predictedScore: 50 + (i * 10), isBest: i === 0 })),
      bestIndex: 0
    };
    try {
      const pyResponse = await axios.post(`${pythonServiceUrl}/predict`, { variations }, { timeout: 4000 });
      predictionData = pyResponse.data;
      console.log(`[Worker] Python analytics response. Best index: ${predictionData.bestIndex}`);
    } catch (pyErr) {
      console.warn("⚠️ Python service unavailable. Using baseline predictions.");
    }

    const bestVar = predictionData.predictions[predictionData.bestIndex];

    await db.updatePost(postId, {
      status: 'completed',
      content: {
        moodTags: bestVar.moodTags,
        poeticCaption: bestVar.poeticCaption,
        variations: predictionData.predictions
      },
      analytics: { predictedScore: bestVar.predictedScore, actualLikes: 0, actualShares: 0 }
    });

    console.log(`[Worker] Job ${postId} completed successfully!`);
  } catch (err) {
    console.error(`❌ Error processing job ${postId}:`, err);
    await db.updatePost(postId, { status: 'failed' });
    throw err;
  }
}

module.exports = processCaptionJob;
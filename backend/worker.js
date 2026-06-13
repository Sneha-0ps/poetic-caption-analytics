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
  },
  {
    mood_tags: ["dreamy", "soft", "ethereal"],
    poetic_caption: "Floating between moments, lost in a pastel reverie.",
    short_captions: ["Soft hours. 🌸", "Dream a little dream. ✨"]
  }
];

function getRandomMock() {
  return MOCK_AI_RESPONSES[Math.floor(Math.random() * MOCK_AI_RESPONSES.length)];
}

// Hard cap: if Gemini hasn't responded in 25s, give up and use mock
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

async function fetchImageAsBase64(imageUrl) {
  console.log("[Worker] Fetching image from:", imageUrl);
  const response = await withTimeout(
    axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 12000 }),
    15000,
    'Image fetch'
  );
  const base64 = Buffer.from(response.data).toString('base64');
  const ct = response.headers['content-type'] || 'image/jpeg';
  const mimeType = ct.split(';')[0].trim();
  console.log(`[Worker] Image fetched. Size: ${base64.length} chars, mime: ${mimeType}`);
  return { base64, mimeType };
}

async function callGeminiAPI(imageUrl) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log("[Worker] No GEMINI_API_KEY — using mock response.");
    await new Promise(r => setTimeout(r, 800));
    return getRandomMock();
  }

  let imageData;
  try {
    imageData = await fetchImageAsBase64(imageUrl);
  } catch (err) {
    console.warn("[Worker] Image fetch failed:", err.message, "— using mock.");
    return getRandomMock();
  }

  console.log("[Worker] Calling Gemini API...");
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [{
        parts: [
          {
            text: `Analyze this image and return ONLY a JSON object with exactly these fields:
1. mood_tags: array of 3-4 short mood/style keywords (e.g. ["cozy", "warm", "nostalgic"])
2. poetic_caption: one poetic sentence matching the image mood (max 150 chars)
3. short_captions: array of exactly 2 short punchy social captions with emojis`
          },
          { inlineData: { mimeType: imageData.mimeType, data: imageData.base64 } }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
        maxOutputTokens: 300,
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

    const response = await withTimeout(
      axios.post(url, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 25000
      }),
      28000,
      'Gemini API call'
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");

    const parsed = JSON.parse(text);
    // Validate the response has required fields
    if (!parsed.mood_tags || !parsed.poetic_caption || !parsed.short_captions) {
      throw new Error("Gemini response missing required fields");
    }
    console.log("[Worker] Gemini response OK. Tags:", parsed.mood_tags);
    return parsed;

  } catch (err) {
    console.error("[Worker] Gemini failed:", err.message);
    if (err.response?.data) {
      console.error("[Worker] Gemini error detail:", JSON.stringify(err.response.data).slice(0, 300));
    }
    console.log("[Worker] Falling back to mock response.");
    return getRandomMock();
  }
}

async function processCaptionJob(job) {
  const { postId, imageUrl } = job.data;
  console.log(`[Worker] ── Starting job for post ${postId}`);
  console.log(`[Worker]    imageUrl: ${imageUrl}`);

  // Safety net: mark as failed after 60s no matter what
  const jobTimeout = setTimeout(async () => {
    console.error(`[Worker] ⏰ Job ${postId} hit 60s safety timeout — marking failed.`);
    try { await db.updatePost(postId, { status: 'failed' }); } catch {}
  }, 60000);

  try {
    await db.updatePost(postId, { status: 'processing' });

    // Step 3: AI captions
    const aiOutput = await callGeminiAPI(imageUrl);
    const { mood_tags, poetic_caption, short_captions } = aiOutput;

    const variations = [
      {
        moodTags: mood_tags,
        poeticCaption: poetic_caption
      },
      {
        moodTags: [mood_tags[0] || 'aesthetic', 'daily'],
        poeticCaption: short_captions[0] || "Chasing moments."
      },
      {
        moodTags: [mood_tags[1] || 'vibes', mood_tags[2] || 'mood'],
        poeticCaption: short_captions[1] || "Just living."
      }
    ];

    // Step 4: Engagement predictions
    let predictionData = {
      predictions: variations.map((v, i) => ({
        ...v,
        predictedScore: 50 + (i * 10),
        isBest: i === 0
      })),
      bestIndex: 0
    };

    try {
      const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';
      const pyResponse = await withTimeout(
        axios.post(`${pythonServiceUrl}/predict`, { variations }, { timeout: 4000 }),
        5000,
        'Python predict'
      );
      predictionData = pyResponse.data;
      console.log(`[Worker] Python predictions OK. Best index: ${predictionData.bestIndex}`);
    } catch (pyErr) {
      console.warn("[Worker] Python service unavailable:", pyErr.message);
    }

    const bestVar = predictionData.predictions[predictionData.bestIndex];

    // Step 5: Save to DB
    await db.updatePost(postId, {
      status: 'completed',
      content: {
        moodTags: bestVar.moodTags,
        poeticCaption: bestVar.poeticCaption,
        variations: predictionData.predictions
      },
      analytics: {
        predictedScore: bestVar.predictedScore,
        actualLikes: 0,
        actualShares: 0
      }
    });

    clearTimeout(jobTimeout);
    console.log(`[Worker] ✅ Job ${postId} completed successfully.`);

  } catch (err) {
    clearTimeout(jobTimeout);
    console.error(`[Worker] ❌ Job ${postId} failed:`, err.message);
    try { await db.updatePost(postId, { status: 'failed' }); } catch {}
    throw err;
  }
}

module.exports = processCaptionJob;
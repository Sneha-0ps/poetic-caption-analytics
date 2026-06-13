const axios = require('axios');
const db = require('./db');

const MOCK_AI_RESPONSES = [
  {
    mood_tags: ["coastal", "serene", "natural"],
    poetic_caption: "Whispers of the ocean sealed in every spiral and curve.",
    short_captions: ["Nature's art, washed ashore. 🐚", "Sea treasures, sun-kissed sand. 🌊"]
  },
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

function getRandomMock() {
  return MOCK_AI_RESPONSES[Math.floor(Math.random() * MOCK_AI_RESPONSES.length)];
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

async function fetchImageAsBase64(imageUrl) {
  const response = await withTimeout(
    axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 12000 }),
    15000, 'Image fetch'
  );
  const base64 = Buffer.from(response.data).toString('base64');
  const ct = response.headers['content-type'] || 'image/jpeg';
  const mimeType = ct.split(';')[0].trim();
  console.log(`[Worker] Image fetched OK — ${base64.length} chars, mime: ${mimeType}`);
  return { base64, mimeType };
}

async function callGeminiAPI(imageUrl) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log("[Worker] No GEMINI_API_KEY — using mock.");
    await new Promise(r => setTimeout(r, 600));
    return getRandomMock();
  }

  let imageData;
  try {
    imageData = await fetchImageAsBase64(imageUrl);
  } catch (err) {
    console.warn("[Worker] Image fetch failed:", err.message, "→ using mock.");
    return getRandomMock();
  }

  try {
    console.log("[Worker] Calling Gemini API...");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await withTimeout(
      axios.post(url, {
        contents: [{
          parts: [
            {
              text: `Analyze this image. Return ONLY valid JSON with these exact fields:
{
  "mood_tags": ["tag1", "tag2", "tag3"],
  "poetic_caption": "one evocative sentence about the image",
  "short_captions": ["short caption 1 with emoji", "short caption 2 with emoji"]
}`
            },
            { inlineData: { mimeType: imageData.mimeType, data: imageData.base64 } }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
          maxOutputTokens: 256,
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 25000
      }),
      28000, 'Gemini API'
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");

    // Strip markdown code fences if present
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!Array.isArray(parsed.mood_tags) || !parsed.poetic_caption || !Array.isArray(parsed.short_captions)) {
      throw new Error("Gemini response missing required fields: " + JSON.stringify(parsed));
    }

    // Ensure short_captions has at least 2 items
    while (parsed.short_captions.length < 2) {
      parsed.short_captions.push("Capturing the moment. ✨");
    }

    console.log("[Worker] Gemini OK — tags:", parsed.mood_tags);
    return parsed;

  } catch (err) {
    console.error("[Worker] Gemini failed:", err.message);
    if (err.response?.data) {
      console.error("[Worker] Detail:", JSON.stringify(err.response.data).slice(0, 400));
    }
    console.log("[Worker] Using mock response as fallback.");
    return getRandomMock();
  }
}

async function processCaptionJob(job) {
  const { postId, imageUrl } = job.data;
  console.log(`\n[Worker] ── Job start: ${postId}`);
  console.log(`[Worker]    imageUrl: ${imageUrl}`);

  // 60s hard safety net
  const safetyTimer = setTimeout(async () => {
    console.error(`[Worker] ⏰ Safety timeout hit for ${postId} — marking failed.`);
    try { await db.updatePost(postId, { status: 'failed' }); } catch {}
  }, 60000);

  try {
    // Step 3: AI captions — ALWAYS returns something (mock on any failure)
    const aiOutput = await callGeminiAPI(imageUrl);
    const { mood_tags, poetic_caption, short_captions } = aiOutput;

    console.log(`[Worker] Building variations...`);
    const variations = [
      {
        moodTags: mood_tags,
        poeticCaption: poetic_caption,
        predictedScore: 70,
        isBest: false
      },
      {
        moodTags: [mood_tags[0] || 'aesthetic', 'daily'],
        poeticCaption: short_captions[0],
        predictedScore: 60,
        isBest: false
      },
      {
        moodTags: [mood_tags[1] || 'vibes', mood_tags[2] || 'mood'],
        poeticCaption: short_captions[1],
        predictedScore: 50,
        isBest: false
      }
    ];

    // Step 4: Python predictions (optional)
    try {
      const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';
      const pyRes = await withTimeout(
        axios.post(`${pythonServiceUrl}/predict`, { variations }, { timeout: 4000 }),
        5000, 'Python predict'
      );
      const preds = pyRes.data.predictions;
      const bestIdx = pyRes.data.bestIndex || 0;
      preds.forEach((p, i) => { p.isBest = i === bestIdx; });
      variations.splice(0, variations.length, ...preds);
      console.log(`[Worker] Python predictions OK.`);
    } catch (pyErr) {
      // Mark variation[0] as best when Python is unavailable
      variations[0].isBest = true;
      variations[0].predictedScore = 70;
      variations[1].predictedScore = 60;
      variations[2].predictedScore = 50;
      console.warn("[Worker] Python unavailable — using baseline scores.");
    }

    const bestVar = variations.find(v => v.isBest) || variations[0];

    // Step 5: Save — this is the critical write
    const updatePayload = {
      status: 'completed',
      content: {
        moodTags: bestVar.moodTags,
        poeticCaption: bestVar.poeticCaption,
        variations: variations
      },
      analytics: {
        predictedScore: bestVar.predictedScore || 70,
        actualLikes: 0,
        actualShares: 0
      }
    };

    console.log(`[Worker] Saving to DB...`);
    console.log(`[Worker] moodTags: ${JSON.stringify(bestVar.moodTags)}`);
    console.log(`[Worker] caption: ${bestVar.poeticCaption?.slice(0, 60)}`);

    const saved = await db.updatePost(postId, updatePayload);
    
    if (!saved) throw new Error("db.updatePost returned null — post may not exist");

    clearTimeout(safetyTimer);
    console.log(`[Worker] ✅ Job ${postId} complete.\n`);

  } catch (err) {
    clearTimeout(safetyTimer);
    console.error(`[Worker] ❌ Job ${postId} failed:`, err.message);
    try { await db.updatePost(postId, { status: 'failed' }); } catch {}
    throw err;
  }
}

module.exports = processCaptionJob;
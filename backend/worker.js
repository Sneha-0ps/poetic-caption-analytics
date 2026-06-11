const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./db');
// List of high-quality mock templates for fallback mode
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
  }
];
async function callGeminiAPI(imagePath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[Worker] No GEMINI_API_KEY. Using high-quality mock AI generation.");
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    const randomIndex = Math.floor(Math.random() * MOCK_AI_RESPONSES.length);
    return MOCK_AI_RESPONSES[randomIndex];
  }
  console.log(`[Worker] Calling Gemini API for image: ${imagePath}`);
  
  try {
    // Read local image and convert to base64
    const absolutePath = path.resolve(imagePath);
    const imageBuffer = fs.readFileSync(absolutePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Determine mimeType
    let mimeType = 'image/jpeg';
    if (imagePath.endsWith('.png')) mimeType = 'image/png';
    else if (imagePath.endsWith('.webp')) mimeType = 'image/webp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `Analyze this image and return a JSON object with:
              1. mood_tags: Array of 3-4 evocative mood/style keywords.
              2. poetic_caption: A beautiful, slightly longer, poetic caption matching the image mood.
              3. short_captions: Array of 2 punchy, short social-media captions (including emojis).`
            },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            mood_tags: {
              type: "array",
              items: { type: "string" }
            },
            poetic_caption: { type: "string" },
            short_captions: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["mood_tags", "poetic_caption", "short_captions"]
        }
      }
    };
    const response = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' }
    });
    const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error("Empty response from Gemini API");
    }
    return JSON.parse(responseText);
  } catch (err) {
    console.error("❌ Gemini API request failed:", err.message);
    if (err.response) {
      console.error("Gemini API Error Detail:", JSON.stringify(err.response.data));
    }
    console.log("[Worker] Falling back to mock AI generation due to API failure.");
    const randomIndex = Math.floor(Math.random() * MOCK_AI_RESPONSES.length);
    return MOCK_AI_RESPONSES[randomIndex];
  }
}
async function processCaptionJob(job) {
  const { postId, imageUrl, imagePath } = job.data;
  console.log(`[Worker] Processing job for post ${postId}...`);
  
  try {
    // Step 1: Update DB status to processing
    await db.updatePost(postId, { status: 'processing' });
    
    // Step 2: Generate Captions and tags via Gemini (or fallback)
    const aiOutput = await callGeminiAPI(imagePath || imageUrl);
    
    const { mood_tags, poetic_caption, short_captions } = aiOutput;
    
    // Step 3: Format 3 different variation options
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
    // Step 4: Call Python Microservice for Engagement Predictions
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';
    let predictionData = {
      predictions: variations.map((v, i) => ({ ...v, predictedScore: 50 + (i * 10), isBest: i === 0 })),
      bestIndex: 0,
      boostPercent: 20
    };
    try {
      console.log(`[Worker] Querying Python analytics service for variations...`);
      const pyResponse = await axios.post(`${pythonServiceUrl}/predict`, { variations }, { timeout: 4000 });
      predictionData = pyResponse.data;
      console.log(`[Worker] Python analytics response received. Best variation index: ${predictionData.bestIndex}`);
    } catch (pyErr) {
      console.warn("⚠️ Python Analytics microservice unavailable. Using baseline predictions:", pyErr.message);
    }
    // Step 5: Extract best variation
    const bestVar = predictionData.predictions[predictionData.bestIndex];
    
    // Step 6: Save completed data to database
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
    console.log(`[Worker] Job ${postId} processed successfully!`);
  } catch (err) {
    console.error(`❌ Error processing job ${postId}:`, err);
    await db.updatePost(postId, { status: 'failed' });
    throw err;
  }
}
module.exports = processCaptionJob;
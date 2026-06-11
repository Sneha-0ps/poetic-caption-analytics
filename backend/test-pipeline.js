const path = require('path');
const db = require('./db');
const processCaptionJob = require('./worker');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
async function runTest() {
  console.log("🚀 Starting End-to-End Pipeline Verification...");
  
  // 1. Connect to Database
  await db.connectDB();
  
  try {
    // 2. Create/Get Test User
    console.log("\n1. Creating/resolving test user...");
    let user;
    try {
      user = await db.createUser("test_pipeline@example.com", "hashed_testpass");
      console.log("✓ Test user created successfully:", user._id);
    } catch (err) {
      user = await db.getUserByEmail("test_pipeline@example.com");
      console.log("✓ Test user already exists, reusing:", user._id);
    }
    // 3. Create a post
    console.log("\n2. Creating post in pending state...");
    const post = await db.createPost(user._id || user.id, "https://picsum.photos/id/237/800/600");
    console.log("✓ Post record created:", post._id);
    // 4. Simulate Background Worker Processing
    console.log("\n3. Invoking background worker processing...");
    const mockJob = {
      data: {
        postId: post._id,
        imageUrl: post.imageUrl,
        imagePath: "mock_image.jpg",
        userId: user._id || user.id
      }
    };
    
    // Execute job processor
    await processCaptionJob(mockJob);
    console.log("✓ Worker finished processing job.");
    // 5. Fetch updated post and assert
    console.log("\n4. Verifying database updates...");
    const updatedPost = await db.getPostById(post._id);
    
    console.log("----------------------------------------");
    console.log("Updated Post Status:", updatedPost.status);
    console.log("Generated Caption:", updatedPost.content?.poeticCaption);
    console.log("Mood Tags:", updatedPost.content?.moodTags);
    console.log("Variations Count:", updatedPost.content?.variations?.length);
    console.log("Best Predicted Score:", updatedPost.analytics?.predictedScore);
    console.log("----------------------------------------");
    // Assertions
    if (updatedPost.status !== 'completed') {
      throw new Error(`Assertion Failed: Post status is ${updatedPost.status}, expected completed`);
    }
    if (!updatedPost.content?.poeticCaption) {
      throw new Error("Assertion Failed: Poetic caption is missing");
    }
    if (updatedPost.content.variations.length !== 3) {
      throw new Error(`Assertion Failed: Expected 3 variations, got ${updatedPost.content.variations.length}`);
    }
    if (updatedPost.analytics.predictedScore === 0) {
      throw new Error("Assertion Failed: Predicted engagement score was not updated");
    }
    
    console.log("\n🎉 Integration Verification SUCCESSFUL! Decoupled AI and Analytics Pipeline is working perfectly.");
  } catch (err) {
    console.error("\n❌ Pipeline verification failed:", err);
  } finally {
    if (!db.isLocal()) {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
    }
    process.exit(0);
  }
}
runTest();

const mongoose = require('mongoose');
const PostSchema = new mongoose.Schema({
  userId: {
    type: String, // String to easily allow mock UUIDs or mongoose ObjectIds
    required: true
  },
  imageUrl: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing'
  },
  content: {
    moodTags: {
      type: [String],
      default: []
    },
    poeticCaption: {
      type: String,
      default: ''
    },
    variations: [
      {
        moodTags: [String],
        poeticCaption: String,
        predictedScore: Number,
        isBest: Boolean
      }
    ]
  },
  analytics: {
    predictedScore: {
      type: Number,
      default: 0
    },
    actualLikes: {
      type: Number,
      default: 0
    },
    actualShares: {
      type: Number,
      default: 0
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});
module.exports = mongoose.model('Post', PostSchema);
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
let jobQueue = null;
let bullWorker = null;
let useLocalQueue = false;
// Simple in-memory job runner
const inMemoryJobs = new Map();
let processJobCallback = null;
function setupInMemoryQueue(processor) {
  useLocalQueue = true;
  processJobCallback = processor;
  console.log("⚠️  No REDIS_URL found. Running with in-memory Queue Manager (Decoupled background worker is ACTIVE).");
}
async function addInMemoryJob(name, data) {
  const jobId = data.postId;
  const job = {
    id: jobId,
    name,
    data,
    status: 'waiting',
    progress: 0,
    timestamp: Date.now()
  };
  
  inMemoryJobs.set(jobId, job);
  
  // Asynchronously execute processor in background to mimic BullMQ behavior
  setTimeout(async () => {
    job.status = 'active';
    console.log(`[Queue: In-Memory] Worker picked up job ${jobId} asynchronously...`);
    try {
      if (processJobCallback) {
        await processJobCallback(job);
        job.status = 'completed';
        console.log(`[Queue: In-Memory] Job ${jobId} completed successfully.`);
      }
    } catch (err) {
      job.status = 'failed';
      job.failedReason = err.message;
      console.error(`[Queue: In-Memory] Job ${jobId} failed:`, err);
    }
  }, 1500); // 1.5 seconds delay to simulate network/queue worker picking it up
  return { id: jobId };
}
const queueManager = {
  initializeQueue: (processor) => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      setupInMemoryQueue(processor);
      return;
    }
    try {
      console.log("⚙️  Connecting BullMQ to Redis at:", redisUrl);
      const connection = new Redis(redisUrl, {
        maxRetriesPerRequest: null
      });
      connection.on('error', (err) => {
        console.error("Redis Connection Error:", err.message);
        if (!useLocalQueue) {
          console.log("⚠️  Switching to in-memory Queue fallback due to Redis connection error...");
          setupInMemoryQueue(processor);
        }
      });
      jobQueue = new Queue('caption-jobs', { connection });
      
      bullWorker = new Worker('caption-jobs', async (job) => {
        console.log(`[Queue: BullMQ] Worker picked up job ${job.id}...`);
        await processor(job);
      }, { connection });
      bullWorker.on('completed', (job) => {
        console.log(`[Queue: BullMQ] Job ${job.id} completed.`);
      });
      bullWorker.on('failed', (job, err) => {
        console.error(`[Queue: BullMQ] Job ${job.id} failed:`, err);
      });
    } catch (err) {
      console.error("❌ Failed to initialize BullMQ queue:", err.message);
      setupInMemoryQueue(processor);
    }
  },
  addJob: async (name, data) => {
    if (useLocalQueue || !jobQueue) {
      return await addInMemoryJob(name, data);
    }
    
    try {
      const job = await jobQueue.add(name, data, {
        jobId: data.postId, // map jobId to postId for easy lookup
        attempts: 2,
        backoff: 5000
      });
      return { id: job.id };
    } catch (err) {
      console.error("BullMQ addJob failed, falling back to in-memory queue:", err.message);
      return await addInMemoryJob(name, data);
    }
  },
  getJobStatus: (jobId) => {
    if (useLocalQueue || !jobQueue) {
      const job = inMemoryJobs.get(jobId);
      if (!job) return null;
      return {
        id: job.id,
        status: job.status,
        failedReason: job.failedReason
      };
    }
    
    // In BullMQ, we check status via database updates, but we can query it as a fallback.
    return null;
  }
};
module.exports = queueManager;
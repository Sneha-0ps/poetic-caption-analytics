const { Queue, Worker } = require('bullmq');

let jobQueue = null;
let bullWorker = null;
let useLocalQueue = false;

const inMemoryJobs = new Map();
let processJobCallback = null;

function setupInMemoryQueue(processor) {
  useLocalQueue = true;
  processJobCallback = processor;
  console.log("⚠️  Running with in-memory Queue Manager (background worker is ACTIVE).");
}

async function addInMemoryJob(name, data) {
  const jobId = data.postId;
  const job = { id: jobId, name, data, status: 'waiting', timestamp: Date.now() };
  inMemoryJobs.set(jobId, job);
  setTimeout(async () => {
    job.status = 'active';
    console.log(`[Queue: In-Memory] Worker picked up job ${jobId}...`);
    try {
      if (processJobCallback) {
        await processJobCallback(job);
        job.status = 'completed';
        console.log(`[Queue: In-Memory] Job ${jobId} completed.`);
      }
    } catch (err) {
      job.status = 'failed';
      job.failedReason = err.message;
      console.error(`[Queue: In-Memory] Job ${jobId} failed:`, err);
    }
  }, 1500);
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
      console.log("⚙️  Connecting BullMQ to Redis...");

      // Parse the Redis URL to build ioredis connection options
      // Upstash and most providers give: rediss://:<password>@<host>:<port>
      // BullMQ needs explicit TLS options when using rediss://
      let connectionOptions;

      try {
        const url = new URL(redisUrl);
        const isTLS = url.protocol === 'rediss:';
        connectionOptions = {
          host: url.hostname,
          port: parseInt(url.port) || (isTLS ? 6380 : 6379),
          password: url.password || undefined,
          username: url.username && url.username !== 'default' ? url.username : undefined,
          tls: isTLS ? { rejectUnauthorized: false } : undefined,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          connectTimeout: 10000,
          lazyConnect: false,
        };
        console.log(`⚙️  Redis target: ${url.hostname}:${connectionOptions.port} TLS=${isTLS}`);
      } catch (parseErr) {
        console.error("❌ Could not parse REDIS_URL:", parseErr.message);
        setupInMemoryQueue(processor);
        return;
      }

      jobQueue = new Queue('caption-jobs', {
        connection: connectionOptions,
        defaultJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 5000 } }
      });

      bullWorker = new Worker('caption-jobs', async (job) => {
        console.log(`[Queue: BullMQ] Worker picked up job ${job.id}...`);
        await processor(job);
      }, {
        connection: { ...connectionOptions },
      });

      bullWorker.on('completed', (job) => {
        console.log(`[Queue: BullMQ] Job ${job.id} completed.`);
      });

      bullWorker.on('failed', (job, err) => {
        console.error(`[Queue: BullMQ] Job ${job?.id} failed:`, err.message);
      });

      bullWorker.on('error', (err) => {
        console.error('[BullMQ Worker error]', err.message);
        if (!useLocalQueue) {
          console.log("⚠️  Switching to in-memory queue fallback...");
          setupInMemoryQueue(processor);
        }
      });

      jobQueue.on('error', (err) => {
        console.error('[BullMQ Queue error]', err.message);
        if (!useLocalQueue) {
          console.log("⚠️  Switching to in-memory queue fallback...");
          setupInMemoryQueue(processor);
        }
      });

    } catch (err) {
      console.error("❌ Failed to initialize BullMQ:", err.message);
      setupInMemoryQueue(processor);
    }
  },

  addJob: async (name, data) => {
    if (useLocalQueue || !jobQueue) {
      return await addInMemoryJob(name, data);
    }
    try {
      const job = await jobQueue.add(name, data, { jobId: data.postId });
      return { id: job.id };
    } catch (err) {
      console.error("BullMQ addJob failed, using in-memory fallback:", err.message);
      return await addInMemoryJob(name, data);
    }
  },

  getJobStatus: (jobId) => {
    if (useLocalQueue || !jobQueue) {
      const job = inMemoryJobs.get(jobId);
      if (!job) return null;
      return { id: job.id, status: job.status, failedReason: job.failedReason };
    }
    return null;
  }
};

module.exports = queueManager;
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { redisConfigSchema } from '@lacquer/schemas';
import { DEMO_QUEUE } from './queue.js';
const { REDIS_URL } = redisConfigSchema.parse(process.env);
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
});
const queue = new Queue(DEMO_QUEUE, { connection });
try {
  const job = await queue.add(
    'demo.ping',
    {},
    { removeOnComplete: 100, removeOnFail: 100 },
  );
  console.info(`Queued demo job ${job.id}`);
} finally {
  await queue.close();
  await connection.quit();
}

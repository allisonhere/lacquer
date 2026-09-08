import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import pino from 'pino';
import { readConfig } from '@lacquer/schemas';
import { workerConnection, DEMO_QUEUE } from './queue.js';
import { dispatch } from './jobs.js';
const config = readConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'lacquer-worker' },
});
const connection = workerConnection(config.REDIS_URL);
connection.on('error', () => logger.error('Redis connection error'));
const worker = new Worker(DEMO_QUEUE, (job) => dispatch(job, logger), {
  connection,
  concurrency: 2,
});
worker.on('error', () => logger.error('Worker connection error'));
worker.on('failed', (job, err) =>
  logger.error({ jobId: job?.id, err }, 'Job failed'),
);
let stopping = false;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') {
    res.end(JSON.stringify({ status: stopping ? 'stopping' : 'ok' }));
    return;
  }
  if (req.url === '/ready') {
    const ready =
      !stopping && worker.isRunning() && connection.status === 'ready';
    res.statusCode = ready ? 200 : 503;
    res.end(JSON.stringify({ status: ready ? 'ok' : 'not_ready' }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not_found' }));
});
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000).unref();
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await worker.close();
    await connection.quit();
  } finally {
    connection.disconnect();
    clearTimeout(deadline);
  }
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
server.on('error', async (err) => {
  logger.error({ err }, 'Health server failed');
  await shutdown();
  process.exitCode = 1;
});
server.listen(config.WORKER_PORT, '0.0.0.0', () =>
  logger.info({ port: config.WORKER_PORT }, 'Worker health server listening'),
);
try {
  await worker.waitUntilReady();
  logger.info('Worker ready');
} catch (err) {
  logger.error({ err }, 'Worker startup failed');
  await shutdown();
  process.exitCode = 1;
}

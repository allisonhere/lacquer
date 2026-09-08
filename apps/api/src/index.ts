import { readConfig } from '@lacquer/schemas';
import { createDatabase } from '@lacquer/db';
import { createRedis } from './redis.js';
import { createApp } from './app.js';
const config = readConfig();
const database = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
redis.on('error', () => {
  console.error(
    JSON.stringify({
      service: 'lacquer-api',
      level: 'error',
      message: 'Redis connection error',
    }),
  );
});
const app = await createApp(config, database.db, redis);
app.addHook('onClose', async () => {
  await Promise.allSettled([
    database.close(),
    redis.quit().finally(() => redis.disconnect()),
  ]);
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000).unref();
  try {
    await app.close();
  } finally {
    clearTimeout(deadline);
  }
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await redis.connect();
  await database.db.execute('select 1');
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error({ err: error }, 'Startup failed');
  await shutdown();
  process.exitCode = 1;
}

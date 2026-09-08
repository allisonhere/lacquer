import { Redis } from 'ioredis';
export function createRedis(url: string) {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    commandTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}

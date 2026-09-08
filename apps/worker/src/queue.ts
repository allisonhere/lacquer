import { Redis } from 'ioredis';
export const DEMO_QUEUE = 'lacquer-development';
export function workerConnection(url: string) {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
/** SvelteKit signs the socket client address; arbitrary Forwarded headers never grant a new bucket. */
export function publicClientKey(req: FastifyRequest, secret: string): string {
  const client = req.headers['x-lacquer-client'],
    signature = req.headers['x-lacquer-client-signature'];
  if (
    typeof client === 'string' &&
    client.length <= 64 &&
    typeof signature === 'string' &&
    /^[a-f0-9]{64}$/.test(signature)
  ) {
    const expected = createHmac('sha256', secret)
      .update(`lacquer:public-client:v1:${client}`)
      .digest();
    if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return client;
  }
  return req.ip;
}

import { it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { publicClientKey } from './public-rate-limit.js';
it('accepts only server-signed visitor addresses, never spoofed proxy headers', () => {
  const secret = 'test-secret',
    client = '198.51.100.4',
    signature = createHmac('sha256', secret)
      .update(`lacquer:public-client:v1:${client}`)
      .digest('hex');
  const req = {
    ip: '127.0.0.1',
    headers: {
      'x-lacquer-client': client,
      'x-lacquer-client-signature': signature,
    },
  } as unknown as FastifyRequest;
  expect(publicClientKey(req, secret)).toBe(client);
  req.headers['x-lacquer-client'] = '198.51.100.5';
  expect(publicClientKey(req, secret)).toBe('127.0.0.1');
  req.headers['x-lacquer-client-signature'] = 'bad';
  expect(publicClientKey(req, secret)).toBe('127.0.0.1');
});

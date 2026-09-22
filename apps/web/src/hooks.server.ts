import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';
const apiOrigin = env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
const parsed = new URL(apiOrigin);
if (
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.pathname !== '/' ||
  parsed.username ||
  parsed.password
)
  throw new Error('API_INTERNAL_URL must be an HTTP origin');
/** Same-origin transport only; Fastify owns authentication and authorization. */
export const handle: Handle = async ({ event, resolve }) => {
  if (
    event.url.pathname.startsWith('/api/') ||
    event.url.pathname === '/openapi.json' ||
    event.url.pathname === '/docs' ||
    event.url.pathname.startsWith('/docs/')
  ) {
    const headers = new Headers();
    for (const key of [
      'content-type',
      'cookie',
      'origin',
      'x-lacquer-request',
      'accept',
    ]) {
      const value = event.request.headers.get(key);
      if (value) headers.set(key, value);
    }
    // These server-only headers are never copied from the incoming request.
    if (
      event.url.pathname.startsWith('/api/v1/public/') &&
      env.SESSION_SECRET
    ) {
      const client = event.getClientAddress();
      headers.set('x-lacquer-client', client);
      headers.set(
        'x-lacquer-client-signature',
        createHmac('sha256', env.SESSION_SECRET)
          .update(`lacquer:public-client:v1:${client}`)
          .digest('hex'),
      );
    }
    try {
      const response = await fetch(
        `${parsed.origin}${event.url.pathname}${event.url.search}`,
        {
          method: event.request.method,
          headers,
          body: ['GET', 'HEAD'].includes(event.request.method)
            ? undefined
            : await event.request.arrayBuffer(),
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        },
      );
      const outgoing = new Headers();
      for (const key of [
        'content-type',
        'cache-control',
        'location',
        'retry-after',
        'x-request-id',
        'x-content-type-options',
        'referrer-policy',
      ]) {
        const value = response.headers.get(key);
        if (value) outgoing.set(key, value);
      }
      for (const value of response.headers.getSetCookie())
        outgoing.append('set-cookie', value);
      return new Response(response.body, {
        status: response.status,
        headers: outgoing,
      });
    } catch {
      return Response.json(
        {
          error: {
            code: 'API_UNAVAILABLE',
            message: 'The service is temporarily unavailable.',
            requestId: crypto.randomUUID(),
          },
        },
        { status: 503 },
      );
    }
  }
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set(
    'Referrer-Policy',
    event.url.pathname.startsWith('/book/') ? 'no-referrer' : 'same-origin',
  );
  if (event.url.pathname.startsWith('/book/')) {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
  }
  return response;
};

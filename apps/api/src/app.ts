import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Database } from '@lacquer/db';
import { errorSchema, type Config } from '@lacquer/schemas';
import { createAuthService } from './services/auth.js';
import { ApiFault } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { tenantRoutes } from './routes/tenants.js';
import { locationRoutes } from './routes/locations.js';
import { typed } from './routes/context.js';
export async function createApp(config: Config, db: Database, redis: Redis) {
  const app = Fastify({
    bodyLimit: 16384,
    requestTimeout: 10000,
    logger: {
      level: config.LOG_LEVEL,
      base: { service: 'lacquer-api' },
      redact: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
      ],
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url?.split('?')[0],
          remoteAddress: req.ip,
        }),
        err: (err) => ({
          type: err.name,
          message: 'Request failed; inspect error code',
          stack:
            typeof err.stack === 'string'
              ? err.stack
                  .split('\n')
                  .filter((line) => /^\s+at /.test(line))
                  .join('\n')
              : '',
        }),
      },
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  const cookieName =
    config.NODE_ENV === 'production'
      ? '__Host-lacquer_session'
      : 'lacquer_session';
  await app.register(rateLimit, {
    redis,
    max: 120,
    timeWindow: '1 minute',
    skipOnError: false,
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Lacquer API',
        version: '0.1.0',
        description:
          'Milestone 1 foundation. Mutations require Origin matching APP_URL and X-Lacquer-Request: 1.',
      },
      components: {
        securitySchemes: {
          sessionCookie: { type: 'apiKey', in: 'cookie', name: cookieName },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Request-Id', req.id)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers.origin !== new URL(config.APP_URL).origin ||
        req.headers['x-lacquer-request'] !== '1'
      )
        throw new ApiFault(
          403,
          'CSRF_REJECTED',
          'Request origin could not be verified.',
        );
    }
  });
  app.addHook('onRoute', (route) => {
    if (route.schema)
      route.schema.response = {
        400: errorSchema,
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
        429: errorSchema,
        500: errorSchema,
        503: errorSchema,
        ...(route.schema.response as Record<string, unknown> | undefined),
      };
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & {
      code?: string;
      statusCode?: number;
      validation?: unknown;
      cause?: { code?: string };
    };
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'An unexpected error occurred.';
    if (err instanceof ApiFault) {
      status = err.statusCode;
      code = err.code;
      message = err.message;
    } else if (
      err.validation ||
      err instanceof z.ZodError ||
      err.statusCode === 400
    ) {
      status = 400;
      code = 'INVALID_INPUT';
      message = 'Check the request fields and try again.';
    } else if (err.code === '23505' || err.cause?.code === '23505') {
      status = 409;
      code = 'CONFLICT';
      message = 'A record with these details already exists.';
    } else if (err.statusCode === 429) {
      status = 429;
      code = 'RATE_LIMITED';
      message = 'Too many requests. Try again shortly.';
    } else if (err.statusCode === 413) {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request is too large.';
    }
    if (status >= 500) req.log.error({ err }, 'Request failed');
    reply.code(status).send({ error: { code, message, requestId: req.id } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found.',
        requestId: req.id,
      },
    }),
  );
  const api = typed(app);
  const healthSchema = z.object({ status: z.literal('ok') });
  api.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: { tags: ['System'], response: { 200: healthSchema } },
    },
    async () => ({ status: 'ok' as const }),
  );
  api.get(
    '/ready',
    {
      config: { rateLimit: false },
      schema: { tags: ['System'], response: { 200: healthSchema } },
    },
    async () => {
      try {
        await Promise.all([db.execute(sql`select 1`), redis.ping()]);
        return { status: 'ok' as const };
      } catch {
        throw new ApiFault(503, 'NOT_READY', 'Dependencies are unavailable.');
      }
    },
  );
  app.get('/openapi.json', async () => app.swagger());
  const deps = {
    config,
    db,
    auth: createAuthService(db, config.SESSION_SECRET),
    cookieName,
  };
  await app.register(
    async (scoped) => {
      await authRoutes(scoped, deps);
      await tenantRoutes(scoped, deps);
      await locationRoutes(scoped, deps);
    },
    { prefix: '/api/v1' },
  );
  return app;
}

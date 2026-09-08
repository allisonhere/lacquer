import {
  registerSchema,
  loginSchema,
  userSchema,
  okSchema,
} from '@lacquer/schemas';
import { SESSION_TTL_SECONDS, tokenDigest } from '../services/auth.js';
import { guards, typed, type Api, type RouteDependencies } from './context.js';
export async function authRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app);
  const { authenticated } = guards(deps);
  const cookie = {
    path: '/',
    httpOnly: true,
    secure: deps.config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_TTL_SECONDS,
  };
  const authRate = { rateLimit: { max: 10, timeWindow: '1 minute' } };
  api.post(
    '/auth/register',
    {
      config: authRate,
      schema: {
        tags: ['Auth'],
        body: registerSchema,
        response: { 201: userSchema },
      },
    },
    async (req, reply) => {
      const result = await deps.auth.register(req.body);
      await deps.auth.logout(req.cookies[deps.cookieName]);
      reply.setCookie(deps.cookieName, result.token, cookie);
      return reply.code(201).send(result.user);
    },
  );
  api.post(
    '/auth/login',
    {
      config: authRate,
      preHandler: app.rateLimit({
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req) =>
          `login-account:${tokenDigest(
            String((req.body as { email?: string } | undefined)?.email ?? '')
              .trim()
              .toLowerCase(),
            deps.config.SESSION_SECRET,
          )}`,
      }),
      schema: {
        tags: ['Auth'],
        body: loginSchema,
        response: { 200: userSchema },
      },
    },
    async (req, reply) => {
      const result = await deps.auth.login(req.body);
      // Logging in replaces the browser's old session, without leaving it reusable.
      await deps.auth.logout(req.cookies[deps.cookieName]);
      reply.setCookie(deps.cookieName, result.token, cookie);
      return result.user;
    },
  );
  api.post(
    '/auth/logout',
    { schema: { tags: ['Auth'], response: { 200: okSchema } } },
    async (req, reply) => {
      await deps.auth.logout(req.cookies[deps.cookieName]);
      reply.clearCookie(deps.cookieName, { path: '/' });
      return { ok: true };
    },
  );
  api.post(
    '/auth/logout-all',
    {
      schema: {
        tags: ['Auth'],
        security: [{ sessionCookie: [] }],
        response: { 200: okSchema },
      },
    },
    async (req, reply) => {
      const { user } = await authenticated(req);
      await deps.auth.revokeAll(user.id);
      reply.clearCookie(deps.cookieName, { path: '/' });
      return { ok: true };
    },
  );
  api.get(
    '/me',
    {
      schema: {
        tags: ['Auth'],
        security: [{ sessionCookie: [] }],
        response: { 200: userSchema },
      },
    },
    async (req) => (await authenticated(req)).user,
  );
}

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq } from 'drizzle-orm';
import {
  createDatabase,
  users,
  tenants,
  tenantMemberships,
  membershipPermissions,
  authTokens,
  sessions,
} from '@lacquer/db';
import {
  readConfig,
  userSchema,
  tenantSchema,
  locationSchema,
  membershipSchema,
} from '@lacquer/schemas';
import { z } from 'zod';
import { createApp } from './app.js';
import { createRedis } from './redis.js';
import { createAuthTokenService } from './services/auth-tokens.js';
import { resolveTenantContext, assertPermission } from './tenant-context.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error(
    'Set TEST_DATABASE_URL to a dedicated database ending in _test',
  );
const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl || new URL(redisUrl).pathname !== '/15')
  throw new Error('Set TEST_REDIS_URL to dedicated Redis database /15');
const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  APP_URL: 'http://localhost:5173',
  SESSION_SECRET: 'integration-only-secret-at-least-32-characters',
  LOG_LEVEL: 'silent',
});
const database = createDatabase(databaseUrl);
const redis = createRedis(redisUrl);
redis.options.keyPrefix = `lacquer-integration-${crypto.randomUUID()}:`;
const app = await createApp(config, database.db, redis);
const suffix = crypto.randomUUID().slice(0, 8);
const password = 'Integration-password-123!';
const headers = { origin: config.APP_URL, 'x-lacquer-request': '1' };
const userIds: string[] = [],
  tenantIds: string[] = [];
let cookieA = '',
  cookieB = '',
  userA = '',
  tenantA = '',
  tenantB = '',
  locationB = '';
function cookieFrom(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header).split(';')[0] ?? '';
}
function request(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  cookie = '',
  payload?: Record<string, unknown>,
) {
  return app.inject({ method, url, headers: { ...headers, cookie }, payload });
}
beforeAll(async () => {
  await redis.connect();
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(
      new URL('../../../packages/db/migrations', import.meta.url),
    ),
  });
  await app.ready();
});
afterAll(async () => {
  for (const id of tenantIds)
    await database.db.delete(tenants).where(eq(tenants.id, id));
  for (const id of userIds)
    await database.db.delete(users).where(eq(users.id, id));
  await app.close();
  await redis.quit();
  await database.close();
});
describe.sequential('foundation with real PostgreSQL and Redis', () => {
  it('registers users and stores only hashes', async () => {
    for (const label of ['a', 'b']) {
      const response = await request('POST', '/api/v1/auth/register', '', {
        email: `${label}-${suffix}@example.test`,
        name: `User ${label}`,
        password,
      });
      expect(response.statusCode).toBe(201);
      const user = userSchema.parse(response.json());
      userIds.push(user.id);
      const cookie = cookieFrom(response);
      expect(cookie).toContain('lacquer_session=');
      expect(response.headers['set-cookie']).toContain('HttpOnly');
      expect(response.headers['set-cookie']).toContain('SameSite=Lax');
      if (label === 'a') {
        cookieA = cookie;
        userA = user.id;
      } else cookieB = cookie;
      const [stored] = await database.db
        .select()
        .from(users)
        .where(eq(users.id, user.id));
      expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(response.body).not.toContain('passwordHash');
      const [session] = await database.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user.id));
      expect(session?.tokenHash).not.toBe(cookie.split('=')[1]);
    }
  });
  it('requires authentication and rejects bad credentials', async () => {
    expect((await request('GET', '/api/v1/me')).statusCode).toBe(401);
    expect(
      (
        await request('POST', '/api/v1/auth/login', '', {
          email: `a-${suffix}@example.test`,
          password: 'wrong',
        })
      ).statusCode,
    ).toBe(401);
    const login = await request('POST', '/api/v1/auth/login', cookieA, {
      email: `a-${suffix}@example.test`,
      password,
    });
    expect(login.statusCode).toBe(200);
    const old = cookieA;
    cookieA = cookieFrom(login);
    expect((await request('GET', '/api/v1/me', old)).statusCode).toBe(401);
    expect((await request('GET', '/api/v1/me', cookieA)).statusCode).toBe(200);
  });
  it('requires an allowed origin and CSRF header on mutations', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: {
            cookie: cookieA,
            origin: 'https://evil.example',
            'x-lacquer-request': '1',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: { cookie: cookieA, origin: config.APP_URL },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('atomically creates owner memberships and isolates membership lists', async () => {
    for (const [label, cookie] of [
      ['a', cookieA],
      ['b', cookieB],
    ]) {
      const response = await request('POST', '/api/v1/tenants', cookie, {
        name: `Salon ${label}`,
        slug: `salon-${label}-${suffix}`,
      });
      expect(response.statusCode).toBe(201);
      const tenant = tenantSchema.parse(response.json());
      tenantIds.push(tenant.id);
      if (label === 'a') tenantA = tenant.id;
      else tenantB = tenant.id;
      const list = await request('GET', '/api/v1/tenants', cookie);
      const memberships = z.array(membershipSchema).parse(list.json());
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.role).toBe('owner');
      expect(memberships[0]?.tenant.id).toBe(tenant.id);
    }
  });
  it('supports tenant read/update and location create/read/update/list', async () => {
    expect(
      (
        await request('PATCH', `/api/v1/tenants/${tenantB}`, cookieB, {
          name: 'Updated salon',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await request('GET', `/api/v1/tenants/${tenantB}`, cookieB)).json().name,
    ).toBe('Updated salon');
    const created = await request(
      'POST',
      `/api/v1/tenants/${tenantB}/locations`,
      cookieB,
      { name: 'Private location', slug: 'main', timezone: 'America/Chicago' },
    );
    expect(created.statusCode).toBe(201);
    const location = locationSchema.parse(created.json());
    locationB = location.id;
    expect(
      (
        await request(
          'GET',
          `/api/v1/tenants/${tenantB}/locations/${locationB}`,
          cookieB,
        )
      ).statusCode,
    ).toBe(200);
    const patched = await request(
      'PATCH',
      `/api/v1/tenants/${tenantB}/locations/${locationB}`,
      cookieB,
      { name: 'Changed location', active: false },
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().active).toBe(false);
    expect(
      (
        await request('GET', `/api/v1/tenants/${tenantB}/locations`, cookieB)
      ).json(),
    ).toHaveLength(1);
  });
  it('denies cross-tenant reads and writes through both tenant and resource substitution', async () => {
    for (const method of ['GET', 'PATCH'] as const) {
      for (const tenant of [tenantA, tenantB]) {
        const response = await request(
          method,
          `/api/v1/tenants/${tenant}/locations/${locationB}`,
          cookieA,
          method === 'PATCH' ? { name: 'STOLEN' } : undefined,
        );
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain('Changed location');
        expect(response.body).not.toContain(locationB);
      }
    }
    expect(
      (
        await request('POST', `/api/v1/tenants/${tenantB}/locations`, cookieA, {
          name: 'Bad',
          slug: 'bad',
          timezone: 'UTC',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await request('GET', `/api/v1/tenants/${tenantB}/locations`, cookieA))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await request('PATCH', `/api/v1/tenants/${tenantB}`, cookieA, {
          name: 'STOLEN',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request(
          'GET',
          `/api/v1/tenants/${tenantB}/locations/${locationB}`,
          cookieB,
        )
      ).json().name,
    ).toBe('Changed location');
  });
  it('rejects ownership injection, invalid IDs, invalid timezones, and duplicate slugs', async () => {
    expect(
      (
        await request(
          'PATCH',
          `/api/v1/tenants/${tenantB}/locations/${locationB}`,
          cookieB,
          { tenantId: tenantA },
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await request('GET', '/api/v1/tenants/not-a-uuid', cookieA)).statusCode,
    ).toBe(400);
    expect(
      (
        await request('POST', `/api/v1/tenants/${tenantA}/locations`, cookieA, {
          name: 'Invalid',
          slug: 'invalid',
          timezone: 'Mars/Olympus',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request('POST', `/api/v1/tenants/${tenantB}/locations`, cookieB, {
          name: 'Duplicate',
          slug: 'main',
          timezone: 'UTC',
        })
      ).statusCode,
    ).toBe(409);
  });
  it('allows multi-tenant membership while enforcing roles and toggles', async () => {
    const [membership] = await database.db
      .insert(tenantMemberships)
      .values({ userId: userA, tenantId: tenantB, role: 'technician' })
      .returning();
    if (!membership) throw new Error('Missing membership');
    expect(
      (await request('GET', '/api/v1/tenants', cookieA)).json(),
    ).toHaveLength(2);
    expect(
      (
        await request(
          'GET',
          `/api/v1/tenants/${tenantB}/locations/${locationB}`,
          cookieA,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          'PATCH',
          `/api/v1/tenants/${tenantB}/locations/${locationB}`,
          cookieA,
          { name: 'Denied' },
        )
      ).statusCode,
    ).toBe(403);
    const context = await resolveTenantContext(database.db, userA, tenantB);
    expect(() => assertPermission(context, 'manage_locations')).toThrow();
    await database.db.insert(membershipPermissions).values({
      membershipId: membership.id,
      permission: 'manage_locations',
      allowed: true,
    });
    expect(
      (
        await request(
          'PATCH',
          `/api/v1/tenants/${tenantB}/locations/${locationB}`,
          cookieA,
          { name: 'Allowed' },
        )
      ).statusCode,
    ).toBe(200);
    await database.db
      .delete(tenantMemberships)
      .where(eq(tenantMemberships.id, membership.id));
    expect(
      (await request('GET', `/api/v1/tenants/${tenantB}`, cookieA)).statusCode,
    ).toBe(404);
  });
  it('excludes suspended tenants', async () => {
    await database.db
      .update(tenants)
      .set({ status: 'suspended' })
      .where(eq(tenants.id, tenantA));
    expect(
      (await request('GET', `/api/v1/tenants/${tenantA}`, cookieA)).statusCode,
    ).toBe(404);
    expect(
      (await request('GET', '/api/v1/tenants', cookieA)).json(),
    ).toHaveLength(0);
    await database.db
      .update(tenants)
      .set({ status: 'active' })
      .where(eq(tenants.id, tenantA));
  });
  it('supports one-time verification, magic links, expiration, and reset revocation', async () => {
    const tokens = createAuthTokenService(database.db, config.SESSION_SECRET);
    const verification = await tokens.issue(userA, 'email_verification');
    await tokens.consume(verification, 'email_verification');
    await expect(
      tokens.consume(verification, 'email_verification'),
    ).rejects.toThrow('invalid');
    const expired = await tokens.issue(userA, 'magic_link');
    await database.db
      .update(authTokens)
      .set({
        createdAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000),
      })
      .where(
        and(eq(authTokens.userId, userA), eq(authTokens.purpose, 'magic_link')),
      );
    await expect(tokens.consume(expired, 'magic_link')).rejects.toThrow(
      'invalid',
    );
    const magic = await tokens.issue(userA, 'magic_link');
    const results = await Promise.allSettled([
      tokens.consume(magic, 'magic_link'),
      tokens.consume(magic, 'magic_link'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const reset = await tokens.issue(userA, 'password_reset');
    await expect(tokens.consume(reset, 'magic_link')).rejects.toThrow(
      'invalid',
    );
    await tokens.consume(reset, 'password_reset', 'Replacement-password-123!');
    expect((await request('GET', '/api/v1/me', cookieA)).statusCode).toBe(401);
    const login = await request('POST', '/api/v1/auth/login', '', {
      email: `a-${suffix}@example.test`,
      password: 'Replacement-password-123!',
    });
    expect(login.statusCode).toBe(200);
    cookieA = cookieFrom(login);
  });
  it('revokes sessions individually and collectively', async () => {
    const logout = await request('POST', '/api/v1/auth/logout', cookieA);
    expect(logout.statusCode).toBe(200);
    expect((await request('GET', '/api/v1/me', cookieA)).statusCode).toBe(401);
    expect(
      (await request('POST', '/api/v1/auth/logout-all', cookieB)).statusCode,
    ).toBe(200);
    expect((await request('GET', '/api/v1/me', cookieB)).statusCode).toBe(401);
  });
  it('serves health, readiness, and OpenAPI', async () => {
    expect((await request('GET', '/health')).statusCode).toBe(200);
    expect((await request('GET', '/ready')).statusCode).toBe(200);
    const docs = await request('GET', '/openapi.json');
    expect(docs.statusCode).toBe(200);
    expect(
      docs.json().paths['/api/v1/tenants/{tenantId}/locations'],
    ).toBeDefined();
    expect((await request('GET', '/docs/')).statusCode).toBe(200);
  });
  it('throttles repeated login attempts with safe errors', async () => {
    let response = await request('POST', '/api/v1/auth/login', '', {
      email: `throttled-${suffix}@example.test`,
      password: 'invalid',
    });
    for (let i = 0; i < 11; i++)
      response = await request('POST', '/api/v1/auth/login', '', {
        email: `throttled-${suffix}@example.test`,
        password: 'invalid',
      });
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMITED');
  });
  it('keeps process health independent of Redis while readiness fails', async () => {
    redis.disconnect();
    try {
      expect((await request('GET', '/health')).statusCode).toBe(200);
      const ready = await request('GET', '/ready');
      expect(ready.statusCode).toBe(503);
      expect(ready.json().error.code).toBe('NOT_READY');
    } finally {
      await redis.connect();
    }
  });
});

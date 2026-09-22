import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  users,
  tenants,
  tenantMemberships,
  membershipPermissions,
  appointments,
  addOns,
  appointmentContacts,
  appointmentPublicAccess,
} from '@lacquer/db';
import { readConfig } from '@lacquer/schemas';
import { createApp } from './app.js';
import { createRedis } from './redis.js';
/**
 * Milestone 2 against real PostgreSQL and Redis.
 *
 * Covers the required scenario chain (staff -> location -> service -> skills ->
 * eligibility -> skill removal), tenant isolation for every new resource, and
 * permission-based denial. Data is uniquely named per run and removed in
 * `afterAll`; the database is never truncated.
 */
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
redis.options.keyPrefix = `lacquer-ops-${crypto.randomUUID()}:`;
const app = await createApp(config, database.db, redis);
const suffix = crypto.randomUUID().slice(0, 8);
const password = 'Integration-password-123!';
const headers = { origin: config.APP_URL, 'x-lacquer-request': '1' };
const userIds: string[] = [];
const tenantIds: string[] = [];
/** Owner of salon A, owner of salon B, and a technician-role member of salon A. */
let ownerA = '',
  ownerB = '',
  techA = '';
let tenantA = '',
  tenantB = '';
let locationA = '',
  locationA2 = '',
  locationB = '';
let staffA = '',
  staffB = '';
let serviceA = '',
  serviceB = '';
let skillAcrylic = '',
  skillArt = '';
let variantXl = '';
let techMembershipId = '';
function cookieFrom(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header).split(';')[0] ?? '';
}
function request(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookie = '',
  payload?: Record<string, unknown>,
) {
  return app.inject({ method, url, headers: { ...headers, cookie }, payload });
}
async function register(label: string) {
  const response = await request('POST', '/api/v1/auth/register', '', {
    email: `${label}-${suffix}@example.test`,
    name: `User ${label}`,
    password,
  });
  expect(response.statusCode).toBe(201);
  userIds.push(response.json().id as string);
  return {
    cookie: cookieFrom(response),
    userId: response.json().id as string,
  };
}
beforeAll(async () => {
  await redis.connect();
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(
      new URL('../../../packages/db/migrations', import.meta.url),
    ),
  });
  await app.ready();
  const a = await register('ops-a');
  const b = await register('ops-b');
  const t = await register('ops-tech');
  ownerA = a.cookie;
  ownerB = b.cookie;
  techA = t.cookie;
  for (const [cookie, label] of [
    [ownerA, 'a'],
    [ownerB, 'b'],
  ] as const) {
    const created = await request('POST', '/api/v1/tenants', cookie, {
      name: `Ops Salon ${label}`,
      slug: `ops-salon-${label}-${suffix}`,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    tenantIds.push(id);
    if (label === 'a') tenantA = id;
    else tenantB = id;
  }
  // A technician-role member of salon A, used for permission denial tests.
  const [membership] = await database.db
    .insert(tenantMemberships)
    .values({ tenantId: tenantA, userId: t.userId, role: 'technician' })
    .returning();
  techMembershipId = membership?.id ?? '';
  for (const [tenant, cookie, slug, target] of [
    [tenantA, ownerA, 'downtown', 'A'],
    [tenantA, ownerA, 'north', 'A2'],
    [tenantB, ownerB, 'downtown', 'B'],
  ] as const) {
    const created = await request(
      'POST',
      `/api/v1/tenants/${tenant}/locations`,
      cookie,
      { name: slug, slug, timezone: 'America/Chicago' },
    );
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    if (target === 'A') locationA = id;
    else if (target === 'A2') locationA2 = id;
    else locationB = id;
  }
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
describe.sequential('salon operations with real PostgreSQL and Redis', () => {
  it('1-2. creates a staff profile and assigns it to a location', async () => {
    const created = await request(
      'POST',
      `/api/v1/tenants/${tenantA}/staff`,
      ownerA,
      { displayName: 'Alex Morgan', email: 'alex@example.test' },
    );
    expect(created.statusCode).toBe(201);
    staffA = created.json().id as string;
    // A profile may exist with no linked user account.
    expect(created.json().userId).toBeNull();
    const assigned = await request(
      'PUT',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/locations`,
      ownerA,
      { locationIds: [locationA] },
    );
    expect(assigned.statusCode).toBe(200);
    const detail = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/staff/${staffA}`,
      ownerA,
    );
    expect(detail.json().locationIds).toEqual([locationA]);
    const staffB_created = await request(
      'POST',
      `/api/v1/tenants/${tenantB}/staff`,
      ownerB,
      { displayName: 'Other Salon Tech' },
    );
    staffB = staffB_created.json().id as string;
  });
  it('3-4. creates a service and offers it at a location', async () => {
    const category = await request(
      'POST',
      `/api/v1/tenants/${tenantA}/categories`,
      ownerA,
      { name: 'Acrylics', slug: 'acrylics', sortOrder: 0 },
    );
    expect(category.statusCode).toBe(201);
    const created = await request(
      'POST',
      `/api/v1/tenants/${tenantA}/services`,
      ownerA,
      {
        name: 'Acrylic Full Set',
        categoryId: category.json().id,
        basePrice: 7500,
        baseDurationMinutes: 90,
      },
    );
    expect(created.statusCode).toBe(201);
    serviceA = created.json().id as string;
    expect(created.json().basePrice).toBe(7500);
    // Null buffers mean "inherit the salon default", not zero.
    expect(created.json().bufferBeforeMinutes).toBeNull();
    const offered = await request(
      'PUT',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/locations`,
      ownerA,
      { locationIds: [locationA] },
    );
    expect(offered.statusCode).toBe(200);
    const serviceB_created = await request(
      'POST',
      `/api/v1/tenants/${tenantB}/services`,
      ownerB,
      { name: 'Other Salon Service', basePrice: 1000, baseDurationMinutes: 30 },
    );
    serviceB = serviceB_created.json().id as string;
  });
  it('5-8. skills gate eligibility until the technician holds them', async () => {
    for (const [name, target] of [
      ['Acrylic', 'acrylic'],
      ['Advanced Nail Art', 'art'],
    ] as const) {
      const created = await request(
        'POST',
        `/api/v1/tenants/${tenantA}/skills`,
        ownerA,
        { name },
      );
      expect(created.statusCode).toBe(201);
      if (target === 'acrylic') skillAcrylic = created.json().id as string;
      else skillArt = created.json().id as string;
    }
    // With no requirements yet, the technician can already perform the service.
    const before = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/staff?locationId=${locationA}`,
      ownerA,
    );
    expect(
      (before.json() as { staffId: string; eligible: boolean }[]).find(
        (row) => row.staffId === staffA,
      )?.eligible,
    ).toBe(true);
    // Requiring a skill the technician lacks makes them ineligible.
    expect(
      (
        await request(
          'PUT',
          `/api/v1/tenants/${tenantA}/services/${serviceA}/skills`,
          ownerA,
          { skillIds: [skillAcrylic] },
        )
      ).statusCode,
    ).toBe(200);
    const gated = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/staff?locationId=${locationA}`,
      ownerA,
    );
    const gatedRow = (
      gated.json() as {
        staffId: string;
        eligible: boolean;
        reasons: string[];
      }[]
    ).find((row) => row.staffId === staffA);
    expect(gatedRow?.eligible).toBe(false);
    expect(gatedRow?.reasons).toContain('missing_required_skill');
    // Granting the skill makes them eligible again.
    expect(
      (
        await request(
          'PUT',
          `/api/v1/tenants/${tenantA}/staff/${staffA}/skills`,
          ownerA,
          { skillIds: [skillAcrylic] },
        )
      ).statusCode,
    ).toBe(200);
    const qualified = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/staff?locationId=${locationA}`,
      ownerA,
    );
    expect(
      (qualified.json() as { staffId: string; eligible: boolean }[]).find(
        (row) => row.staffId === staffA,
      )?.eligible,
    ).toBe(true);
  });
  it('9-10. removing the skill makes eligibility false again', async () => {
    expect(
      (
        await request(
          'PUT',
          `/api/v1/tenants/${tenantA}/staff/${staffA}/skills`,
          ownerA,
          { skillIds: [] },
        )
      ).statusCode,
    ).toBe(200);
    const revoked = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/staff?locationId=${locationA}`,
      ownerA,
    );
    const row = (
      revoked.json() as {
        staffId: string;
        eligible: boolean;
        reasons: string[];
      }[]
    ).find((entry) => entry.staffId === staffA);
    expect(row?.eligible).toBe(false);
    expect(row?.reasons).toContain('missing_required_skill');
    // Restore for the remaining scenarios.
    await request(
      'PUT',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/skills`,
      ownerA,
      { skillIds: [skillAcrylic] },
    );
  });
  it('applies a variant’s additional skill requirement', async () => {
    const variant = await request(
      'POST',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/variants`,
      ownerA,
      { name: 'XL', price: 9500, durationMinutes: 120 },
    );
    expect(variant.statusCode).toBe(201);
    variantXl = variant.json().id as string;
    // Explicit effective values, not adjustments to the parent service.
    expect(variant.json().price).toBe(9500);
    await request(
      'PUT',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/variants/${variantXl}/skills`,
      ownerA,
      { skillIds: [skillArt] },
    );
    const withVariant = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/staff?locationId=${locationA}&variantId=${variantXl}`,
      ownerA,
    );
    const row = (
      withVariant.json() as {
        staffId: string;
        eligible: boolean;
        price: number;
      }[]
    ).find((entry) => entry.staffId === staffA);
    expect(row?.eligible).toBe(false);
    expect(row?.price).toBe(9500);
  });
  it('resolves effective price, duration, and buffers through the override chain', async () => {
    await request(
      'PATCH',
      `/api/v1/tenants/${tenantA}/scheduling-settings`,
      ownerA,
      { defaultBufferBeforeMinutes: 5, defaultBufferAfterMinutes: 10 },
    );
    const salonDefaults = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/staff`,
      ownerA,
    );
    const base = (
      salonDefaults.json() as {
        staffId: string;
        price: number;
        durationMinutes: number;
        bufferBeforeMinutes: number;
        bufferAfterMinutes: number;
        totalMinutes: number;
      }[]
    ).find((row) => row.staffId === staffA);
    expect(base).toMatchObject({
      price: 7500,
      durationMinutes: 90,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 10,
      totalMinutes: 105,
    });
    // Service-level buffer beats the salon default.
    await request(
      'PATCH',
      `/api/v1/tenants/${tenantA}/services/${serviceA}`,
      ownerA,
      { bufferAfterMinutes: 20 },
    );
    // Technician override beats both.
    await request(
      'PUT',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/services/${serviceA}/override`,
      ownerA,
      { priceOverride: 9000, bufferBeforeOverrideMinutes: 0 },
    );
    const overridden = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/services/${serviceA}/staff`,
      ownerA,
    );
    expect(
      (
        overridden.json() as {
          staffId: string;
          price: number;
          bufferBeforeMinutes: number;
          bufferAfterMinutes: number;
        }[]
      ).find((row) => row.staffId === staffA),
    ).toMatchObject({
      price: 9000,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 20,
    });
  });
  it('accepts split shifts and recurring breaks, and rejects overlaps', async () => {
    const shift = (startMinute: number, endMinute: number, kind = 'work') =>
      request(
        'POST',
        `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`,
        ownerA,
        { locationId: locationA, weekday: 1, startMinute, endMinute, kind },
      );
    // Monday 09:00-13:00 and 16:00-20:00 is a split shift, not a conflict.
    expect((await shift(540, 780)).statusCode).toBe(201);
    expect((await shift(960, 1200)).statusCode).toBe(201);
    // An overlapping work block is rejected.
    expect((await shift(700, 900)).statusCode).toBe(409);
    // A break inside working time is fine; breaks are checked against breaks.
    expect((await shift(750, 780, 'break')).statusCode).toBe(201);
    expect((await shift(760, 790, 'break')).statusCode).toBe(409);
    // Backwards bounds are rejected by validation, not by the database.
    expect((await shift(900, 800)).statusCode).toBe(400);
    const listed = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`,
      ownerA,
    );
    expect(
      (listed.json() as { kind: string }[]).filter((b) => b.kind === 'work'),
    ).toHaveLength(2);
  });
  it('refuses to schedule a technician at a location they are not assigned to', async () => {
    const response = await request(
      'POST',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`,
      ownerA,
      { locationId: locationA2, weekday: 3, startMinute: 540, endMinute: 780 },
    );
    expect(response.statusCode).toBe(400);
  });
  it('replaces a whole week atomically and rejects an overlapping submission', async () => {
    const conflicting = await request(
      'PUT',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`,
      ownerA,
      {
        locationId: locationA,
        blocks: [
          { weekday: 2, startMinute: 540, endMinute: 780, kind: 'work' },
          { weekday: 2, startMinute: 700, endMinute: 900, kind: 'work' },
        ],
      },
    );
    expect(conflicting.statusCode).toBe(409);
    const replaced = await request(
      'PUT',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`,
      ownerA,
      {
        locationId: locationA,
        blocks: [
          { weekday: 1, startMinute: 540, endMinute: 780, kind: 'work' },
          { weekday: 1, startMinute: 960, endMinute: 1200, kind: 'work' },
          { weekday: 3, startMinute: 540, endMinute: 1020, kind: 'work' },
        ],
      },
    );
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toHaveLength(3);
  });
  it('stores time off as absolute instants and validates the range', async () => {
    const created = await request(
      'POST',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/time-off`,
      ownerA,
      {
        locationId: locationA,
        startsAt: '2026-10-14T14:00:00Z',
        endsAt: '2026-10-16T22:00:00Z',
        reason: 'Vacation',
      },
    );
    expect(created.statusCode).toBe(201);
    expect(created.json().startsAt).toBe('2026-10-14T14:00:00.000Z');
    expect(created.json().locationTimezone).toBe('America/Chicago');
    expect(created.json().status).toBe('scheduled');
    // Backwards ranges are rejected.
    expect(
      (
        await request(
          'POST',
          `/api/v1/tenants/${tenantA}/staff/${staffA}/time-off`,
          ownerA,
          {
            startsAt: '2026-10-16T22:00:00Z',
            endsAt: '2026-10-14T14:00:00Z',
          },
        )
      ).statusCode,
    ).toBe(400);
    // Cancelling keeps the record rather than deleting it.
    const cancelled = await request(
      'PATCH',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/time-off/${created.json().id}`,
      ownerA,
      { status: 'cancelled' },
    );
    expect(cancelled.json().status).toBe('cancelled');
  });
  it('records dated added and removed availability separately', async () => {
    for (const kind of ['added', 'removed'] as const) {
      const response = await request(
        'POST',
        `/api/v1/tenants/${tenantA}/staff/${staffA}/availability-overrides`,
        ownerA,
        {
          locationId: locationA,
          kind,
          localDate: kind === 'added' ? '2026-10-18' : '2026-10-20',
          startMinute: 600,
          endMinute: 900,
        },
      );
      expect(response.statusCode).toBe(201);
      expect(response.json().kind).toBe(kind);
      // A local calendar date, never converted to a UTC instant on the way in.
      expect(response.json().localDate).toBe(
        kind === 'added' ? '2026-10-18' : '2026-10-20',
      );
    }
    const listed = await request(
      'GET',
      `/api/v1/tenants/${tenantA}/staff/${staffA}/availability-overrides`,
      ownerA,
    );
    expect(listed.json()).toHaveLength(2);
  });
  it('denies cross-tenant access to every new resource', async () => {
    // Salon B's owner may not read or write salon A's records, whether they
    // address them through A's tenant ID or their own.
    const attempts: [string, string][] = [
      ['GET', `/api/v1/tenants/${tenantA}/staff`],
      ['GET', `/api/v1/tenants/${tenantA}/staff/${staffA}`],
      ['GET', `/api/v1/tenants/${tenantA}/services`],
      ['GET', `/api/v1/tenants/${tenantA}/services/${serviceA}`],
      ['GET', `/api/v1/tenants/${tenantA}/skills`],
      ['GET', `/api/v1/tenants/${tenantA}/categories`],
      ['GET', `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`],
      ['GET', `/api/v1/tenants/${tenantA}/staff/${staffA}/time-off`],
      ['GET', `/api/v1/tenants/${tenantA}/scheduling-settings`],
    ];
    for (const [method, url] of attempts) {
      const response = await request(method as 'GET', url, ownerB);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.body).not.toContain('Alex Morgan');
      expect(response.body).not.toContain('Acrylic Full Set');
    }
    // Substituting salon A's resource ID under salon B's tenant is a 404, not
    // a leak: the row is unreachable because the scope predicate never matches.
    expect(
      (
        await request(
          'GET',
          `/api/v1/tenants/${tenantB}/staff/${staffA}`,
          ownerB,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request(
          'GET',
          `/api/v1/tenants/${tenantB}/services/${serviceA}`,
          ownerB,
        )
      ).statusCode,
    ).toBe(404);
  });
  it('isolates Milestone 3 appointments and booking resource substitution', async () => {
    const [appointment] = await database.db
      .insert(appointments)
      .values({
        tenantId: tenantA,
        locationId: locationA,
        primaryStaffId: staffA,
        source: 'staff',
        startsAt: new Date('2026-10-14T14:00:00Z'),
        endsAt: new Date('2026-10-14T15:00:00Z'),
        locationTimezone: 'America/Chicago',
        totalServiceMinutes: 60,
        totalOccupancyMinutes: 60,
        subtotalMinorUnits: 7500,
      })
      .returning();
    const id = appointment!.id;
    for (const tenant of [tenantA, tenantB]) {
      expect(
        (
          await request(
            'GET',
            `/api/v1/tenants/${tenant}/appointments/${id}`,
            ownerB,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await request(
            'POST',
            `/api/v1/tenants/${tenant}/appointments/${id}/reschedule`,
            ownerB,
            { startsAt: '2026-10-14T16:00:00Z' },
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await request(
            'POST',
            `/api/v1/tenants/${tenant}/appointments/${id}/cancel`,
            ownerB,
            {},
          )
        ).statusCode,
      ).toBe(404);
    }
    const search = {
      locationId: locationB,
      staffId: staffB,
      services: [{ serviceId: serviceB }],
      date: '2026-10-14',
    };
    for (const extra of [
      { staffId: staffA },
      { services: [{ serviceId: serviceA }] },
    ]) {
      expect(
        (
          await request(
            'POST',
            `/api/v1/tenants/${tenantB}/availability/search`,
            ownerB,
            { ...search, ...extra },
          )
        ).statusCode,
      ).toBe(404);
    }
    expect(
      (
        await request(
          'POST',
          `/api/v1/tenants/${tenantB}/appointments`,
          ownerB,
          {
            locationId: locationA,
            staffId: staffB,
            services: [{ serviceId: serviceB }],
            startsAt: '2026-10-14T14:00:00Z',
            idempotencyKey: crypto.randomUUID(),
          },
        )
      ).statusCode,
    ).toBe(404);
    // Database backstop: a bare resource substitution cannot be persisted either.
    await expect(
      database.db.insert(appointments).values({
        tenantId: tenantB,
        locationId: locationA,
        primaryStaffId: staffB,
        source: 'staff',
        startsAt: new Date('2026-10-14T14:00:00Z'),
        endsAt: new Date('2026-10-14T15:00:00Z'),
        locationTimezone: 'America/Chicago',
        totalServiceMinutes: 60,
        totalOccupancyMinutes: 60,
        subtotalMinorUnits: 7500,
      }),
    ).rejects.toThrow();
  });
  it('extends isolation to public selections and guest snapshot foreign keys', async () => {
    const [tenant] = await database.db
      .update(tenants)
      .set({ publicBookingEnabled: true })
      .where(eq(tenants.id, tenantB))
      .returning();
    const [addon] = await database.db
      .insert(addOns)
      .values({
        tenantId: tenantA,
        name: 'Private addon',
        price: 500,
        durationMinutes: 10,
      })
      .returning();
    const selection = {
      locationId: locationB,
      serviceId: serviceB,
      staffId: staffB,
      date: '2026-10-14',
    };
    for (const patch of [
      { locationId: locationA },
      { serviceId: serviceA },
      { variantId: variantXl },
      { addOnIds: [addon!.id] },
      { staffId: staffA },
    ]) {
      const response = await request(
        'POST',
        `/api/v1/public/${tenant!.slug}/availability/search`,
        '',
        { ...selection, ...patch },
      );
      expect(response.statusCode, response.body).toBe(404);
    }
    const [appointment] = await database.db
      .select()
      .from(appointments)
      .where(eq(appointments.tenantId, tenantA));
    await expect(
      database.db
        .insert(appointmentContacts)
        .values({
          tenantId: tenantB,
          appointmentId: appointment!.id,
          firstName: 'Wrong',
          lastName: 'Tenant',
          email: 'test@example.test',
          phone: '1234567890',
        }),
    ).rejects.toThrow();
    await expect(
      database.db
        .insert(appointmentPublicAccess)
        .values({
          tenantId: tenantB,
          appointmentId: appointment!.id,
          tokenHash: 'f'.repeat(64),
          priceMode: 'exact',
          durationMode: 'exact',
        }),
    ).rejects.toThrow();
  });
  it('denies cross-tenant skill, location, and service references', async () => {
    // Salon B cannot give its own technician one of salon A's skills.
    expect(
      (
        await request(
          'PUT',
          `/api/v1/tenants/${tenantB}/staff/${staffB}/skills`,
          ownerB,
          { skillIds: [skillAcrylic] },
        )
      ).statusCode,
    ).toBe(404);
    // Nor assign them to salon A's location.
    expect(
      (
        await request(
          'PUT',
          `/api/v1/tenants/${tenantB}/staff/${staffB}/locations`,
          ownerB,
          { locationIds: [locationA] },
        )
      ).statusCode,
    ).toBe(404);
    // Nor offer its own service at salon A's location.
    expect(
      (
        await request(
          'PUT',
          `/api/v1/tenants/${tenantB}/services/${serviceB}/locations`,
          ownerB,
          { locationIds: [locationA] },
        )
      ).statusCode,
    ).toBe(404);
    // Nor override one of salon A's services for its own technician.
    expect(
      (
        await request(
          'PUT',
          `/api/v1/tenants/${tenantB}/staff/${staffB}/services/${serviceA}/override`,
          ownerB,
          { priceOverride: 1 },
        )
      ).statusCode,
    ).toBe(404);
    // Nor point its own service at one of salon A's categories.
    const categoryA = (
      await request('GET', `/api/v1/tenants/${tenantA}/categories`, ownerA)
    ).json()[0].id as string;
    expect(
      (
        await request(
          'PATCH',
          `/api/v1/tenants/${tenantB}/services/${serviceB}`,
          ownerB,
          { categoryId: categoryA },
        )
      ).statusCode,
    ).toBe(404);
  });
  it('denies cross-tenant schedule writes through resource substitution', async () => {
    expect(
      (
        await request(
          'POST',
          `/api/v1/tenants/${tenantB}/staff/${staffA}/schedule`,
          ownerB,
          {
            locationId: locationB,
            weekday: 1,
            startMinute: 540,
            endMinute: 780,
          },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request(
          'POST',
          `/api/v1/tenants/${tenantB}/staff/${staffA}/time-off`,
          ownerB,
          { startsAt: '2026-10-14T14:00:00Z', endsAt: '2026-10-15T14:00:00Z' },
        )
      ).statusCode,
    ).toBe(404);
  });
  it('enforces permissions: a technician reads but cannot write', async () => {
    // A technician-role member of salon A can read the catalog...
    expect(
      (await request('GET', `/api/v1/tenants/${tenantA}/staff`, techA))
        .statusCode,
    ).toBe(200);
    expect(
      (await request('GET', `/api/v1/tenants/${tenantA}/services`, techA))
        .statusCode,
    ).toBe(200);
    // ...but every write is forbidden by the default role permissions.
    const writes: [string, string, Record<string, unknown>][] = [
      [
        'POST',
        `/api/v1/tenants/${tenantA}/staff`,
        { displayName: 'Should not exist' },
      ],
      [
        'POST',
        `/api/v1/tenants/${tenantA}/services`,
        { name: 'Nope', basePrice: 100, baseDurationMinutes: 30 },
      ],
      ['POST', `/api/v1/tenants/${tenantA}/skills`, { name: 'Nope' }],
      [
        'POST',
        `/api/v1/tenants/${tenantA}/categories`,
        { name: 'Nope', slug: 'nope' },
      ],
      [
        'PATCH',
        `/api/v1/tenants/${tenantA}/scheduling-settings`,
        { minimumBookingNoticeMinutes: 0 },
      ],
      [
        'PUT',
        `/api/v1/tenants/${tenantA}/staff/${staffA}/skills`,
        { skillIds: [] },
      ],
    ];
    for (const [method, url, payload] of writes)
      expect(
        (await request(method as 'POST', url, techA, payload)).statusCode,
        `${method} ${url}`,
      ).toBe(403);
  });
  it('honours a tenant-level permission override for a fixed role', async () => {
    await database.db.insert(membershipPermissions).values({
      membershipId: techMembershipId,
      permission: 'manage_services',
      allowed: true,
    });
    // The same technician may now manage services in this salon only.
    const created = await request(
      'POST',
      `/api/v1/tenants/${tenantA}/skills`,
      techA,
      { name: `Granted skill ${suffix}` },
    );
    expect(created.statusCode).toBe(201);
    // Staff management was not granted, so it stays denied.
    expect(
      (
        await request('POST', `/api/v1/tenants/${tenantA}/staff`, techA, {
          displayName: 'Still denied',
        })
      ).statusCode,
    ).toBe(403);
    // Revoking the toggle restores the role default.
    await database.db
      .update(membershipPermissions)
      .set({ allowed: false })
      .where(eq(membershipPermissions.membershipId, techMembershipId));
    expect(
      (
        await request('POST', `/api/v1/tenants/${tenantA}/skills`, techA, {
          name: 'Denied again',
        })
      ).statusCode,
    ).toBe(403);
  });
  it('rejects ownership injection and out-of-range domain values', async () => {
    // tenantId in the body is refused by the strict create schema.
    expect(
      (
        await request('POST', `/api/v1/tenants/${tenantA}/staff`, ownerA, {
          displayName: 'Injected',
          tenantId: tenantB,
        })
      ).statusCode,
    ).toBe(400);
    const badServices: Record<string, unknown>[] = [
      { name: 'Negative price', basePrice: -1, baseDurationMinutes: 30 },
      { name: 'Zero duration', basePrice: 100, baseDurationMinutes: 0 },
      {
        name: 'Negative buffer',
        basePrice: 100,
        baseDurationMinutes: 30,
        bufferBeforeMinutes: -5,
      },
      {
        name: 'Active exceeds duration',
        basePrice: 100,
        baseDurationMinutes: 30,
        activeTimeMinutes: 60,
      },
    ];
    for (const payload of badServices)
      expect(
        (
          await request(
            'POST',
            `/api/v1/tenants/${tenantA}/services`,
            ownerA,
            payload,
          )
        ).statusCode,
        String(payload.name),
      ).toBe(400);
    // Weekday and minute ranges are validated too.
    expect(
      (
        await request(
          'POST',
          `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`,
          ownerA,
          {
            locationId: locationA,
            weekday: 8,
            startMinute: 540,
            endMinute: 780,
          },
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          'POST',
          `/api/v1/tenants/${tenantA}/staff/${staffA}/schedule`,
          ownerA,
          {
            locationId: locationA,
            weekday: 1,
            startMinute: 540,
            endMinute: 2000,
          },
        )
      ).statusCode,
    ).toBe(400);
  });
  it('documents every new route group in OpenAPI', async () => {
    const docs = await request('GET', '/openapi.json', ownerA);
    expect(docs.statusCode).toBe(200);
    const paths = docs.json().paths as Record<string, unknown>;
    for (const path of [
      '/api/v1/tenants/{tenantId}/staff',
      '/api/v1/tenants/{tenantId}/staff/{staffId}/schedule',
      '/api/v1/tenants/{tenantId}/staff/{staffId}/time-off',
      '/api/v1/tenants/{tenantId}/staff/{staffId}/availability-overrides',
      '/api/v1/tenants/{tenantId}/categories',
      '/api/v1/tenants/{tenantId}/services',
      '/api/v1/tenants/{tenantId}/services/{serviceId}/variants',
      '/api/v1/tenants/{tenantId}/services/{serviceId}/staff',
      '/api/v1/tenants/{tenantId}/add-ons',
      '/api/v1/tenants/{tenantId}/skills',
      '/api/v1/tenants/{tenantId}/scheduling-settings',
    ])
      expect(paths[path], path).toBeDefined();
  });
});

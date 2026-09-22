import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, sql } from 'drizzle-orm';
import {
  createDatabase,
  tenants,
  users,
  locations,
  staffProfiles,
  staffLocationAssignments,
  services,
  serviceLocations,
  tenantSchedulingSettings,
  staffScheduleBlocks,
  staffTimeOff,
  staffServiceOverrides,
  appointments,
  staffAvailabilityOverrides,
  serviceVariants,
  addOns,
  serviceAddOns,
  tenantMemberships,
} from '@lacquer/db';
import { readConfig, appointmentCreateSchema } from '@lacquer/schemas';
import {
  addLocalDays,
  localDateAt,
  localInstant,
  weekdayOfLocalDate,
} from '@lacquer/booking-engine';
import { createApp } from './app.js';
import { createRedis } from './redis.js';
import { createBookingService } from './services/booking.js';
import { resolveTenantContext } from './tenant-context.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Use a dedicated TEST_DATABASE_URL ending in _test');
const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl || new URL(redisUrl).pathname !== '/15')
  throw new Error('Use dedicated TEST_REDIS_URL /15');
const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  APP_URL: 'http://localhost:5173',
  SESSION_SECRET: 'integration-only-secret-at-least-32-characters',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_MAX: '10000',
});
const database = createDatabase(databaseUrl),
  db = database.db,
  redis = createRedis(redisUrl);
redis.options.keyPrefix = `booking-${crypto.randomUUID()}:`;
const app = await createApp(config, db, redis);
let cookie = '',
  tenantId = '',
  userId = '',
  locationId = '';
const timezone = 'America/Chicago';
const date = addLocalDays(localDateAt(timezone, Date.now()), 7);
const instant = (minute: number, day = date) =>
  new Date(localInstant(timezone, day, minute)).toISOString();
const base = () => `/api/v1/tenants/${tenantId}`;
const request = (
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url,
    headers: { origin: config.APP_URL, 'x-lacquer-request': '1', cookie },
    payload,
  });
beforeAll(async () => {
  await redis.connect();
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL('../../../packages/db/migrations', import.meta.url),
    ),
  });
  await app.ready();
  const registered = await request('POST', '/api/v1/auth/register', {
    name: 'Booking Owner',
    email: `booking-${crypto.randomUUID()}@example.test`,
    password: 'Integration-password-123!',
  });
  expect(registered.statusCode, registered.body).toBe(201);
  userId = registered.json().id;
  cookie = String(registered.headers['set-cookie']).split(';')[0]!;
  const created = await request('POST', '/api/v1/tenants', {
    name: 'Booking Salon',
    slug: `booking-${crypto.randomUUID()}`,
  });
  expect(created.statusCode, created.body).toBe(201);
  tenantId = created.json().id;
  const [location] = await db
    .insert(locations)
    .values({ tenantId, name: 'Main', slug: 'main', timezone })
    .returning();
  locationId = location!.id;
  await db.insert(tenantSchedulingSettings).values({
    tenantId,
    minimumBookingNoticeMinutes: 0,
    defaultBufferAfterMinutes: 0,
  });
});
afterAll(async () => {
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  await app.close();
  await redis.quit();
  await database.close();
});
async function fixture(
  options: {
    duration?: number;
    after?: number;
    split?: boolean;
    active?: number;
    processing?: number;
  } = {},
) {
  const [staff] = await db
    .insert(staffProfiles)
    .values({ tenantId, displayName: 'Technician' })
    .returning();
  const staffId = staff!.id;
  await db
    .insert(staffLocationAssignments)
    .values({ tenantId, staffId, locationId });
  const [service] = await db
    .insert(services)
    .values({
      tenantId,
      name: 'Manicure',
      basePrice: 5000,
      baseDurationMinutes: options.duration ?? 60,
      bufferAfterMinutes: options.after ?? 0,
      activeTimeMinutes: options.active,
      processingTimeMinutes: options.processing,
    })
    .returning();
  const serviceId = service!.id;
  await db.insert(serviceLocations).values({ tenantId, serviceId, locationId });
  await db.insert(staffScheduleBlocks).values(
    (options.split
      ? [
          [540, 780],
          [960, 1200],
        ]
      : [[540, 1020]]
    ).map(([startMinute, endMinute]) => ({
      tenantId,
      staffId,
      locationId,
      weekday: weekdayOfLocalDate(date),
      startMinute: startMinute!,
      endMinute: endMinute!,
    })),
  );
  const selection = { locationId, staffId, services: [{ serviceId }] };
  const search = async (extra = {}) => {
    const response = await request('POST', `${base()}/availability/search`, {
      ...selection,
      date,
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as {
      startsAt: string;
      endsAt: string;
      staffId: string;
      totalServiceMinutes: number;
      totalOccupancyMinutes: number;
      subtotalMinorUnits: number;
    }[];
  };
  const create = (minute = 540, extra = {}) =>
    request('POST', `${base()}/appointments`, {
      ...selection,
      startsAt: instant(minute),
      idempotencyKey: crypto.randomUUID(),
      ...extra,
    });
  const count = async () =>
    (
      await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, tenantId),
            eq(appointments.primaryStaffId, staffId),
          ),
        )
    ).length;
  return { staffId, serviceId, selection, search, create, count };
}
describe.sequential('core booking with real PostgreSQL and Redis', () => {
  it('09:00 appears, books, disappears, and persists historical snapshots', async () => {
    const f = await fixture();
    expect((await f.search())[0]?.startsAt).toBe(instant(540));
    const created = await f.create();
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().services[0]).toMatchObject({
      serviceName: 'Manicure',
      priceMinorUnits: 5000,
      durationMinutes: 60,
    });
    expect(created.json().staffAssignments[0].staffId).toBe(f.staffId);
    expect((await f.search()).some((s) => s.startsAt === instant(540))).toBe(
      false,
    );
    await db
      .update(services)
      .set({ name: 'Changed', basePrice: 9999, baseDurationMinutes: 90 })
      .where(eq(services.id, f.serviceId));
    const detail = await request(
      'GET',
      `${base()}/appointments/${created.json().id}`,
    );
    expect(detail.json().services[0]).toMatchObject({
      serviceName: 'Manicure',
      priceMinorUnits: 5000,
      durationMinutes: 60,
    });
  });
  it('respects a 15-minute after-buffer', async () => {
    const f = await fixture({ after: 15 });
    expect((await f.create()).statusCode).toBe(201);
    expect((await f.search())[0]?.startsAt).toBe(instant(615));
  });
  it('does not bridge split shifts', async () => {
    const f = await fixture({ split: true });
    const slots = await f.search();
    expect(slots.some((s) => s.startsAt === instant(750))).toBe(false);
    expect(slots.some((s) => s.startsAt === instant(960))).toBe(true);
    expect((await f.create(750)).statusCode).toBe(409);
  });
  it('subtracts recurring breaks, time off, and dated overrides', async () => {
    const f = await fixture();
    await db.insert(staffScheduleBlocks).values({
      tenantId,
      staffId: f.staffId,
      locationId,
      weekday: weekdayOfLocalDate(date),
      kind: 'break',
      startMinute: 660,
      endMinute: 690,
    });
    await db.insert(staffTimeOff).values({
      tenantId,
      staffId: f.staffId,
      startsAt: new Date(instant(600)),
      endsAt: new Date(instant(660)),
      locationTimezone: timezone,
    });
    await db.insert(staffAvailabilityOverrides).values([
      {
        tenantId,
        staffId: f.staffId,
        locationId,
        localDate: date,
        kind: 'removed',
        startMinute: 720,
        endMinute: 780,
      },
      {
        tenantId,
        staffId: f.staffId,
        locationId,
        localDate: date,
        kind: 'added',
        startMinute: 1020,
        endMinute: 1080,
      },
    ]);
    const slots = await f.search();
    for (const minute of [600, 660, 720])
      expect(slots.some((s) => s.startsAt === instant(minute))).toBe(false);
    expect(slots.some((s) => s.startsAt === instant(1020))).toBe(true);
    await db
      .update(staffTimeOff)
      .set({ status: 'cancelled' })
      .where(eq(staffTimeOff.staffId, f.staffId));
    expect((await f.search()).some((s) => s.startsAt === instant(600))).toBe(
      true,
    );
  });
  it('uses technician duration overrides of 90 minutes', async () => {
    const f = await fixture();
    await db.insert(staffServiceOverrides).values({
      tenantId,
      staffId: f.staffId,
      serviceId: f.serviceId,
      durationOverrideMinutes: 90,
    });
    expect((await f.search())[0]).toMatchObject({
      totalServiceMinutes: 90,
      endsAt: instant(630),
    });
  });
  it('cancels once, records actor/reason, and releases capacity', async () => {
    const f = await fixture();
    const created = await f.create();
    const path = `${base()}/appointments/${created.json().id}/cancel`;
    const cancelled = await request('POST', path, {
      reason: 'Client requested',
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().cancelledAt).toBeTruthy();
    expect(
      cancelled
        .json()
        .history.find((h: { action: string }) => h.action === 'cancelled'),
    ).toMatchObject({ actorId: userId, reason: 'Client requested' });
    expect((await request('POST', path, {})).json().history).toHaveLength(2);
    expect((await f.search())[0]?.startsAt).toBe(instant(540));
  });
  it('reschedules atomically, preserves snapshots and releases old capacity', async () => {
    const f = await fixture();
    const created = await f.create();
    const id = created.json().id;
    await db
      .update(services)
      .set({ baseDurationMinutes: 90, basePrice: 9999 })
      .where(eq(services.id, f.serviceId));
    const moved = await request(
      'POST',
      `${base()}/appointments/${id}/reschedule`,
      { startsAt: instant(720) },
    );
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({
      startsAt: instant(720),
      endsAt: instant(780),
      subtotalMinorUnits: 5000,
    });
    expect(moved.json().services).toEqual(created.json().services);
    const slots = await f.search();
    expect(slots.some((s) => s.startsAt === instant(540))).toBe(true);
    expect(slots.some((s) => s.startsAt === instant(720))).toBe(false);
    expect(
      moved
        .json()
        .history.find((h: { action: string }) => h.action === 'rescheduled')
        .previousStartsAt,
    ).toBe(instant(540));
  });
  it('a failed reschedule leaves the old appointment intact', async () => {
    const f = await fixture();
    const first = await f.create();
    await f.create(720);
    expect(
      (
        await request(
          'POST',
          `${base()}/appointments/${first.json().id}/reschedule`,
          { startsAt: instant(720) },
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await request('GET', `${base()}/appointments/${first.json().id}`)).json()
        .startsAt,
    ).toBe(instant(540));
  });
  it('serializes a reschedule racing a create for the same new slot', async () => {
    const f = await fixture();
    const original = await f.create();
    const id = original.json().id;
    const responses = await Promise.all([
      request('POST', `${base()}/appointments/${id}/reschedule`, {
        startsAt: instant(720),
      }),
      f.create(720),
    ]);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(1);
    expect(
      responses.filter((r) => r.statusCode === 200 || r.statusCode === 201),
    ).toHaveLength(1);
    const rows = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.primaryStaffId, f.staffId),
        ),
      );
    expect(
      rows.filter((r) => r.startsAt.toISOString() === instant(720)),
    ).toHaveLength(1);
    if (responses[0]!.statusCode === 409) {
      expect(rows.find((r) => r.id === id)!.startsAt.toISOString()).toBe(
        instant(540),
      );
    }
  });
  it('mandatory concurrency: two overlapping creates produce exactly one 201 and one safe 409', async () => {
    const f = await fixture();
    // Hold the production lock so both independent HTTP operations queue before validation.
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>((r) => {
      ready = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`lacquer:booking:${tenantId}`}, 0))`,
      );
      ready();
      await gate;
    });
    await held;
    const one = f.create(),
      two = f.create();
    // Inject starts lazily; attach continuations before releasing the lock.
    const pending = Promise.all([one, two]);
    try {
      // Observe both real PostgreSQL sessions waiting on this tenant's lock.
      // This fails if the operations accidentally execute sequentially.
      await expect
        .poll(
          async () => {
            const rows =
              await db.execute(sql`select count(*)::int as count from pg_locks
          where locktype = 'advisory' and not granted
          and (classid::bigint::numeric * 4294967296 + objid::bigint::numeric) =
            (hashtextextended(${`lacquer:booking:${tenantId}`}, 0)::numeric + 18446744073709551616) % 18446744073709551616`);
            return Number(rows[0]?.count);
          },
          { timeout: 5000, interval: 20 },
        )
        .toBe(2);
    } finally {
      release();
      await holder;
    }
    const responses = await pending;
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = responses.find((r) => r.statusCode === 409)!;
    expect(loser.json().error.code).toBe('SLOT_UNAVAILABLE');
    expect(loser.body).not.toContain('Manicure');
    expect(loser.body).not.toContain(userId);
    expect(await f.count()).toBe(1);
  });
  it('mandatory idempotency: concurrent retries return one appointment and incompatible reuse conflicts', async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const responses = await Promise.all([
      f.create(540, { idempotencyKey: key }),
      f.create(540, { idempotencyKey: key }),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
    expect(await f.count()).toBe(1);
    const conflict = await f.create(600, { idempotencyKey: key });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('domain operations enforce permissions without relying on route handlers', async () => {
    const [tech] = await db
      .insert(users)
      .values({
        email: `tech-${crypto.randomUUID()}@example.test`,
        name: 'Tech',
      })
      .returning();
    try {
      await db
        .insert(tenantMemberships)
        .values({ tenantId, userId: tech!.id, role: 'technician' });
      const context = await resolveTenantContext(db, tech!.id, tenantId),
        f = await fixture();
      await expect(
        createBookingService(db).createAppointment(
          context,
          appointmentCreateSchema.parse({
            ...f.selection,
            startsAt: instant(540),
            idempotencyKey: crypto.randomUUID(),
            forceConflict: true,
            reason: 'Denied',
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await db.delete(users).where(eq(users.id, tech!.id));
    }
  });
  it('any available uses deterministic staff ordering and switches when the first is occupied', async () => {
    const f = await fixture();
    const [second] = await db
      .insert(staffProfiles)
      .values({ tenantId, displayName: 'Second' })
      .returning();
    await db
      .insert(staffLocationAssignments)
      .values({ tenantId, staffId: second!.id, locationId });
    await db.insert(staffScheduleBlocks).values({
      tenantId,
      staffId: second!.id,
      locationId,
      weekday: weekdayOfLocalDate(date),
      startMinute: 540,
      endMinute: 1020,
    });
    const slots = await f.search({ staffId: undefined, anyAvailable: true });
    const first = slots
      .filter((s) => s.startsAt === instant(540))
      .map((s) => s.staffId);
    expect(first).toEqual([...first].sort());
    const created = await f.create(540, {
      staffId: undefined,
      anyAvailable: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().primaryStaffId).toBe(first[0]);
    const next = await f.create(540, {
      staffId: undefined,
      anyAvailable: true,
    });
    expect(next.statusCode, next.body).toBe(201);
    expect(next.json().primaryStaffId).toBe(first[1]);
  });
  it('snapshots variants and add-ons and includes add-on active duration', async () => {
    const f = await fixture();
    const [variant] = await db
      .insert(serviceVariants)
      .values({
        tenantId,
        serviceId: f.serviceId,
        name: 'Deluxe',
        price: 7000,
        durationMinutes: 90,
      })
      .returning();
    const [addon] = await db
      .insert(addOns)
      .values({ tenantId, name: 'Art', price: 500, durationMinutes: 15 })
      .returning();
    await db
      .insert(serviceAddOns)
      .values({ tenantId, serviceId: f.serviceId, addOnId: addon!.id });
    const response = await f.create(540, {
      services: [
        {
          serviceId: f.serviceId,
          variantId: variant!.id,
          addOnIds: [addon!.id],
        },
      ],
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      subtotalMinorUnits: 7500,
      totalServiceMinutes: 105,
      endsAt: instant(645),
    });
    expect(response.json().services[0].variantName).toBe('Deluxe');
    expect(response.json().addons[0]).toMatchObject({
      name: 'Art',
      priceMinorUnits: 500,
      durationMinutes: 15,
    });
  });
  it('enforces daily caps inside concurrent booking transactions', async () => {
    const f = await fixture();
    await db
      .update(staffProfiles)
      .set({ maxAppointmentsPerDay: 1 })
      .where(eq(staffProfiles.id, f.staffId));
    const responses = await Promise.all([f.create(540), f.create(720)]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.statusCode === 409)!.json().error.code).toBe(
      'DAILY_APPOINTMENT_LIMIT_REACHED',
    );
    expect(await f.count()).toBe(1);
  });
  it('intelligent overlap admits processing but not active overlap or other locations', async () => {
    await db
      .update(tenantSchedulingSettings)
      .set({ doubleBookingMode: 'intelligent_overlap' })
      .where(eq(tenantSchedulingSettings.tenantId, tenantId));
    try {
      const f = await fixture({ active: 30, processing: 30 });
      expect((await f.create()).statusCode).toBe(201);
      expect((await f.create(555)).statusCode).toBe(409);
      expect((await f.create(570)).statusCode).toBe(201);
      const [other] = await db
        .insert(locations)
        .values({ tenantId, name: 'Other', slug: 'other', timezone })
        .returning();
      await db
        .insert(staffLocationAssignments)
        .values({ tenantId, staffId: f.staffId, locationId: other!.id });
      await db
        .insert(serviceLocations)
        .values({ tenantId, serviceId: f.serviceId, locationId: other!.id });
      await db.insert(staffScheduleBlocks).values({
        tenantId,
        staffId: f.staffId,
        locationId: other!.id,
        weekday: weekdayOfLocalDate(date),
        startMinute: 540,
        endMinute: 1020,
      });
      expect((await f.create(600, { locationId: other!.id })).statusCode).toBe(
        409,
      );
    } finally {
      await db
        .update(tenantSchedulingSettings)
        .set({ doubleBookingMode: 'disabled' })
        .where(eq(tenantSchedulingSettings.tenantId, tenantId));
    }
  });
  it('manual mode hides overlaps and audits an explicit staff override', async () => {
    await db
      .update(tenantSchedulingSettings)
      .set({ doubleBookingMode: 'manual_override' })
      .where(eq(tenantSchedulingSettings.tenantId, tenantId));
    try {
      const f = await fixture();
      await f.create();
      expect((await f.search()).some((s) => s.startsAt === instant(540))).toBe(
        false,
      );
      expect((await f.create()).statusCode).toBe(409);
      const forced = await f.create(540, {
        forceConflict: true,
        reason: 'Manager approved',
      });
      expect(forced.statusCode, forced.body).toBe(201);
      expect(forced.json().history[0]).toMatchObject({
        forcedConflict: true,
        actorId: userId,
        reason: 'Manager approved',
      });
      expect(
        (
          await f.create(540, {
            source: 'online',
            forceConflict: true,
            reason: 'Disallowed',
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await db
        .update(tenantSchedulingSettings)
        .set({ doubleBookingMode: 'disabled' })
        .where(eq(tenantSchedulingSettings.tenantId, tenantId));
    }
  });
  it('rejects off-grid starts and serves pagination and OpenAPI', async () => {
    const f = await fixture();
    expect((await f.create(541)).statusCode).toBe(409);
    await f.create();
    await f.create(720);
    const listed = await request(
      'GET',
      `${base()}/appointments?staffId=${f.staffId}&limit=1&offset=1`,
    );
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].startsAt).toBe(instant(720));
    const docs = await request('GET', '/openapi.json');
    expect(docs.statusCode, docs.body).toBe(200);
    expect(
      docs.json().paths[
        '/api/v1/tenants/{tenantId}/appointments/{appointmentId}/reschedule'
      ],
    ).toBeDefined();
  });
});

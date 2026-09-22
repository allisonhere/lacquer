import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq } from 'drizzle-orm';
import {
  createDatabase,
  tenants,
  locations,
  services,
  serviceLocations,
  staffProfiles,
  staffLocationAssignments,
  staffScheduleBlocks,
  tenantSchedulingSettings,
  serviceVariants,
  addOns,
  serviceAddOns,
  appointments,
  appointmentContacts,
  appointmentPublicAccess,
  appointmentServices,
} from '@lacquer/db';
import { readConfig } from '@lacquer/schemas';
import {
  addLocalDays,
  localDateAt,
  localInstant,
  weekdayOfLocalDate,
} from '@lacquer/booking-engine';
import { createApp } from './app.js';
import { createRedis } from './redis.js';
const url = process.env.TEST_DATABASE_URL,
  redisUrl = process.env.TEST_REDIS_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith('_test') ||
  !redisUrl ||
  new URL(redisUrl).pathname !== '/15'
)
  throw Error('Dedicated test database and Redis /15 required');
const database = createDatabase(url),
  db = database.db,
  redis = createRedis(redisUrl);
redis.options.keyPrefix = `public-${crypto.randomUUID()}:`;
const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: 'http://localhost:5173',
  SESSION_SECRET: 'public-test-secret-at-least-32-characters',
  RATE_LIMIT_MAX: '10000',
  LOG_LEVEL: 'silent',
});
const app = await createApp(config, db, redis);
const tenantIds: string[] = [];
const timezone = 'America/Chicago',
  date = addLocalDays(localDateAt(timezone, Date.now()), 7);
const at = (minute: number) =>
  new Date(localInstant(timezone, date, minute)).toISOString();
let requestIp = 0;
// Independent visitors keep rate-limit testing separate from domain correctness.
const request = (
  method: 'GET' | 'POST',
  path: string,
  payload?: unknown,
  ip?: string,
) =>
  app.inject({
    method,
    url: `/api/v1/public${path}`,
    remoteAddress:
      ip ?? `10.1.${Math.floor(++requestIp / 250)}.${(requestIp % 250) + 1}`,
    headers: { origin: config.APP_URL, 'x-lacquer-request': '1' },
    payload: payload as Record<string, unknown>,
  });
beforeAll(async () => {
  await redis.connect();
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL('../../../packages/db/migrations', import.meta.url),
    ),
  });
  await app.ready();
});
afterAll(async () => {
  for (const id of tenantIds)
    await db.delete(tenants).where(eq(tenants.id, id));
  await app.close();
  await redis.quit();
  await database.close();
});
async function fixture() {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Public Salon',
      slug: `public-${crypto.randomUUID()}`,
      publicBookingEnabled: true,
    })
    .returning();
  const tenantId = tenant!.id;
  tenantIds.push(tenantId);
  const [location] = await db
    .insert(locations)
    .values({
      tenantId,
      name: 'Garden studio',
      slug: 'garden',
      timezone,
      addressLine1: '10 Garden Lane',
    })
    .returning();
  const [staff] = await db
    .insert(staffProfiles)
    .values({
      tenantId,
      displayName: 'Alex',
      email: 'private@example.test',
      phone: '9999999999',
      bio: 'Internal profile',
    })
    .returning();
  const [service] = await db
    .insert(services)
    .values({
      tenantId,
      name: 'Gel manicure',
      description: 'A lasting finish',
      internalDescription: 'Never public',
      basePrice: 5000,
      baseDurationMinutes: 60,
    })
    .returning();
  const [variant] = await db
    .insert(serviceVariants)
    .values({
      tenantId,
      serviceId: service!.id,
      name: 'Deluxe',
      price: 6000,
      durationMinutes: 75,
    })
    .returning();
  const [addon] = await db
    .insert(addOns)
    .values({
      tenantId,
      name: 'French finish',
      price: 1000,
      durationMinutes: 15,
    })
    .returning();
  await db
    .insert(serviceAddOns)
    .values({ tenantId, serviceId: service!.id, addOnId: addon!.id });
  await db
    .insert(serviceLocations)
    .values({ tenantId, serviceId: service!.id, locationId: location!.id });
  await db
    .insert(staffLocationAssignments)
    .values({ tenantId, staffId: staff!.id, locationId: location!.id });
  await db
    .insert(staffScheduleBlocks)
    .values({
      tenantId,
      staffId: staff!.id,
      locationId: location!.id,
      weekday: weekdayOfLocalDate(date),
      startMinute: 540,
      endMinute: 1020,
    });
  await db
    .insert(tenantSchedulingSettings)
    .values({
      tenantId,
      minimumBookingNoticeMinutes: 0,
      defaultBufferAfterMinutes: 0,
    });
  const selection = {
    locationId: location!.id,
    serviceId: service!.id,
    variantId: variant!.id,
    addOnIds: [addon!.id],
  };
  const contact = {
    firstName: 'Morgan',
    lastName: 'Lee',
    email: 'morgan@example.test',
    phone: '+1 312 555 0100',
    customerNote: 'Short almond shape please.',
  };
  const payload = {
    ...selection,
    staffId: staff!.id,
    startsAt: at(540),
    idempotencyKey: crypto.randomUUID(),
    contact,
  };
  return {
    tenantId,
    slug: tenant!.slug,
    location: location!,
    staff: staff!,
    service: service!,
    variant: variant!,
    addon: addon!,
    selection,
    payload,
  };
}
describe('public guest booking boundary with real database', () => {
  it('resolves enabled active salons without tenant IDs and hides inactive locations', async () => {
    const f = await fixture();
    await db
      .insert(locations)
      .values({
        tenantId: f.tenantId,
        name: 'Closed',
        slug: 'closed',
        timezone,
        active: false,
      });
    const res = await request('GET', `/${f.slug}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().locations).toHaveLength(1);
    expect(res.body).not.toContain(f.tenantId);
    await db
      .update(tenants)
      .set({ publicBookingEnabled: false })
      .where(eq(tenants.id, f.tenantId));
    expect((await request('GET', `/${f.slug}`)).statusCode).toBe(404);
    await db
      .update(tenants)
      .set({ publicBookingEnabled: true, status: 'suspended' })
      .where(eq(tenants.id, f.tenantId));
    expect((await request('GET', `/${f.slug}`)).statusCode).toBe(404);
  });
  it('exposes only online services and customer-safe staff; masks hidden prices/durations', async () => {
    const f = await fixture();
    for (const patch of [
      { active: false },
      { visibleOnline: false },
      { acceptsOnlineBooking: false },
    ]) {
      const [s] = await db
        .insert(services)
        .values({
          tenantId: f.tenantId,
          name: 'Hidden',
          basePrice: 2000,
          baseDurationMinutes: 30,
          ...patch,
        })
        .returning();
      await db
        .insert(serviceLocations)
        .values({
          tenantId: f.tenantId,
          serviceId: s!.id,
          locationId: f.location.id,
        });
    }
    let res = await request(
      'GET',
      `/${f.slug}/services?locationId=${f.location.id}`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.body).not.toContain('Never public');
    expect(res.body).not.toContain(f.tenantId);
    res = await request('POST', `/${f.slug}/staff`, f.selection);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()[0]).toMatchObject({
      id: f.staff.id,
      priceMinorUnits: 7000,
      durationMinutes: 90,
    });
    expect(res.body).not.toContain('private@example');
    expect(res.body).not.toContain('Internal profile');
    await db
      .update(services)
      .set({ priceDisplayMode: 'hidden', durationDisplayMode: 'hidden' })
      .where(eq(services.id, f.service.id));
    res = await request('POST', `/${f.slug}/availability/search`, {
      ...f.selection,
      anyAvailable: true,
      date,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()[0]).toMatchObject({
      priceMinorUnits: null,
      durationMinutes: null,
    });
    expect(res.body).not.toContain('endsAt');
    await db
      .update(staffProfiles)
      .set({ acceptsOnlineBookings: false })
      .where(eq(staffProfiles.id, f.staff.id));
    expect(
      (await request('POST', `/${f.slug}/staff`, f.selection)).json(),
    ).toEqual([]);
  });
  it('creates durable contact/snapshots, hashes token and reveals only its own booking', async () => {
    const f = await fixture(),
      res = await request('POST', `/${f.slug}/bookings`, f.payload);
    expect(res.statusCode, res.body).toBe(201);
    const { token, booking } = res.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(booking).toMatchObject({
      staffName: 'Alex',
      priceMinorUnits: 7000,
      durationMinutes: 90,
      contact: f.payload.contact,
    });
    const [contact] = await db
      .select()
      .from(appointmentContacts)
      .where(eq(appointmentContacts.tenantId, f.tenantId));
    expect(contact).toMatchObject(f.payload.contact);
    const [access] = await db
      .select()
      .from(appointmentPublicAccess)
      .where(eq(appointmentPublicAccess.tenantId, f.tenantId));
    expect(access!.tokenHash).not.toBe(token);
    expect(access!.tokenHash).toHaveLength(64);
    await db
      .update(services)
      .set({ name: 'Changed', basePrice: 9999 })
      .where(eq(services.id, f.service.id));
    const lookup = await request('GET', `/bookings/${token}`);
    expect(lookup.statusCode, lookup.body).toBe(200);
    expect(lookup.json().serviceName).toBe('Gel manicure');
    expect(lookup.body).not.toContain('tenantId');
    expect(lookup.body).not.toContain('actorId');
    expect(lookup.body).not.toContain('history');
    expect(
      (await request('GET', `/bookings/${'x'.repeat(43)}`)).statusCode,
    ).toBe(404);
    expect(
      (await request('GET', `/bookings/${access!.appointmentId}`)).statusCode,
    ).toBe(404);
    const other = await fixture(),
      otherRes = await request('POST', `/${other.slug}/bookings`, {
        ...other.payload,
        contact: { ...other.payload.contact, firstName: 'Other' },
      });
    expect(otherRes.statusCode).toBe(201);
    expect(
      (await request('GET', `/bookings/${otherRes.json().token}`)).json()
        .contact.firstName,
    ).toBe('Other');
    expect(
      (await request('GET', `/bookings/${token}`)).json().contact.firstName,
    ).toBe('Morgan');
  });
  it('concurrent identical retries return one booking and token; changed contact conflicts', async () => {
    const f = await fixture();
    const rs = await Promise.all([
      request('POST', `/${f.slug}/bookings`, f.payload),
      request('POST', `/${f.slug}/bookings`, f.payload),
    ]);
    expect(rs.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(rs[0]!.json()).toEqual(rs[1]!.json());
    expect(
      await db
        .select()
        .from(appointments)
        .where(eq(appointments.tenantId, f.tenantId)),
    ).toHaveLength(1);
    const res = await request('POST', `/${f.slug}/bookings`, {
      ...f.payload,
      contact: { ...f.payload.contact, firstName: 'Changed' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('public slot race is safe, leaves no orphan contacts and permits a fresh-slot retry', async () => {
    const f = await fixture();
    const search = await request('POST', `/${f.slug}/availability/search`, {
      ...f.selection,
      anyAvailable: true,
      date,
    });
    expect(search.json()[0].startsAt).toBe(at(540));
    const rs = await Promise.all([
      request('POST', `/${f.slug}/bookings`, f.payload),
      request('POST', `/${f.slug}/bookings`, {
        ...f.payload,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.statusCode === 409)!.json().error.code).toBe(
      'SLOT_UNAVAILABLE',
    );
    for (const table of [
      appointments,
      appointmentContacts,
      appointmentPublicAccess,
      appointmentServices,
    ])
      expect(
        await db.select().from(table).where(eq(table.tenantId, f.tenantId)),
      ).toHaveLength(1);
    const retry = await request('POST', `/${f.slug}/bookings`, {
      ...f.payload,
      startsAt: at(660),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(retry.statusCode, retry.body).toBe(201);
  });
  it('rejects tenant substitution for location, service, variant, add-on and staff', async () => {
    const a = await fixture(),
      b = await fixture();
    for (const patch of [
      { locationId: b.location.id },
      { serviceId: b.service.id },
      { variantId: b.variant.id },
      { addOnIds: [b.addon.id] },
      { staffId: b.staff.id },
    ]) {
      const res = await request('POST', `/${a.slug}/bookings`, {
        ...a.payload,
        ...patch,
      });
      expect(res.statusCode, res.body).toBe(404);
      const search = await request('POST', `/${a.slug}/availability/search`, {
        ...a.selection,
        staffId: a.staff.id,
        date,
        ...patch,
      });
      expect(search.statusCode, search.body).toBe(404);
    }
    expect(
      await db
        .select()
        .from(appointmentContacts)
        .where(eq(appointmentContacts.tenantId, a.tenantId)),
    ).toHaveLength(0);
  });
  it('enforces required/exclusive add-ons and rejects privilege injection', async () => {
    const f = await fixture();
    await db
      .update(serviceAddOns)
      .set({ required: true, exclusiveGroup: 'finish' })
      .where(
        and(
          eq(serviceAddOns.tenantId, f.tenantId),
          eq(serviceAddOns.serviceId, f.service.id),
        ),
      );
    expect(
      (
        await request('POST', `/${f.slug}/bookings`, {
          ...f.payload,
          addOnIds: [],
        })
      ).statusCode,
    ).toBe(400);
    const [other] = await db
      .insert(addOns)
      .values({
        tenantId: f.tenantId,
        name: 'Other finish',
        price: 100,
        durationMinutes: 0,
      })
      .returning();
    await db
      .insert(serviceAddOns)
      .values({
        tenantId: f.tenantId,
        serviceId: f.service.id,
        addOnId: other!.id,
        exclusiveGroup: 'finish',
      });
    expect(
      (
        await request('POST', `/${f.slug}/bookings`, {
          ...f.payload,
          addOnIds: [f.addon.id, other!.id],
        })
      ).statusCode,
    ).toBe(400);
    for (const patch of [
      { forceConflict: true },
      { source: 'staff' },
      { tenantId: f.tenantId },
      { createdBy: crypto.randomUUID() },
    ])
      expect(
        (
          await request('POST', `/${f.slug}/bookings`, {
            ...f.payload,
            ...patch,
          })
        ).statusCode,
      ).toBe(400);
  });
  it('rate limits token guesses and documents safe public schemas', async () => {
    for (let i = 0; i < 30; i++)
      expect(
        (
          await request(
            'GET',
            `/bookings/${'x'.repeat(43)}`,
            undefined,
            '10.9.9.9',
          )
        ).statusCode,
      ).toBe(404);
    expect(
      (
        await request(
          'GET',
          `/bookings/${'x'.repeat(43)}`,
          undefined,
          '10.9.9.9',
        )
      ).statusCode,
    ).toBe(429);
    const docs = await app.inject({ url: '/openapi.json' });
    expect(docs.statusCode).toBe(200);
    expect(
      docs.json().paths['/api/v1/public/{tenantSlug}/bookings'].post.security,
    ).toEqual([]);
  });
});

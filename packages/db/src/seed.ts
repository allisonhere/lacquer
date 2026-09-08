import { hash, argon2id } from 'argon2';
import { databaseConfigSchema } from '@lacquer/schemas';
import {
  createDatabase,
  users,
  tenants,
  tenantMemberships,
  locations,
} from './index.js';
if (process.env.NODE_ENV === 'production')
  throw new Error('Development seed is disabled in production');
const { DATABASE_URL } = databaseConfigSchema.parse(process.env);
const database = createDatabase(DATABASE_URL);
try {
  const passwordHash = await hash('Development-only-123!', {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await database.db.transaction(async (tx) => {
    const [owner] = await tx
      .insert(users)
      .values({ email: 'owner@example.test', name: 'Demo Owner', passwordHash })
      .onConflictDoUpdate({ target: users.email, set: { name: 'Demo Owner' } })
      .returning();
    const [staff] = await tx
      .insert(users)
      .values({
        email: 'staff@example.test',
        name: 'Demo Technician',
        passwordHash,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: 'Demo Technician' },
      })
      .returning();
    if (!owner || !staff) throw new Error('Seed user missing');
    for (const [slug, name] of [
      ['demo-nails', 'Demo Nail Studio'],
      ['demo-beauty', 'Demo Beauty Studio'],
    ] as const) {
      const [tenant] = await tx
        .insert(tenants)
        .values({ slug, name })
        .onConflictDoUpdate({ target: tenants.slug, set: { name } })
        .returning();
      if (!tenant) throw new Error('Seed tenant missing');
      await tx
        .insert(tenantMemberships)
        .values([
          { tenantId: tenant.id, userId: owner.id, role: 'owner' },
          { tenantId: tenant.id, userId: staff.id, role: 'technician' },
        ])
        .onConflictDoNothing();
      await tx
        .insert(locations)
        .values({
          tenantId: tenant.id,
          name: 'Main Studio',
          slug: 'main-studio',
          timezone: 'America/Chicago',
          addressLine1: '123 Example Street',
          city: 'Example City',
          region: 'IL',
          country: 'US',
        })
        .onConflictDoNothing();
    }
  });
  console.info('Development seed ready (see README for fake credentials)');
} finally {
  await database.close();
}

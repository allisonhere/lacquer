import { present } from './present.js';
import { eq } from 'drizzle-orm';
import { locations, tenantScope, type Database } from '@lacquer/db';
import type { LocationInput, LocationPatch } from '@lacquer/schemas';
import { assertPermission, type TenantContext } from '../tenant-context.js';
import { notFound } from '../errors.js';
export function createLocationService(db: Database) {
  const scope = (context: TenantContext, id?: string) =>
    tenantScope(
      locations.tenantId,
      context.tenantId,
      id ? eq(locations.id, id) : undefined,
    );
  return {
    list: async (context: TenantContext) =>
      (
        await db
          .select()
          .from(locations)
          .where(scope(context))
          .orderBy(locations.name)
      ).map(present),
    async get(context: TenantContext, id: string) {
      const [location] = await db
        .select()
        .from(locations)
        .where(scope(context, id));
      if (!location) throw notFound();
      return present(location);
    },
    async create(context: TenantContext, input: LocationInput) {
      assertPermission(context, 'manage_locations');
      const [location] = await db
        .insert(locations)
        .values({ ...input, tenantId: context.tenantId })
        .returning();
      if (!location) throw new Error('Location insert failed');
      return present(location);
    },
    async update(context: TenantContext, id: string, input: LocationPatch) {
      assertPermission(context, 'manage_locations');
      const [location] = await db
        .update(locations)
        .set(input)
        .where(scope(context, id))
        .returning();
      if (!location) throw notFound();
      return present(location);
    },
  };
}

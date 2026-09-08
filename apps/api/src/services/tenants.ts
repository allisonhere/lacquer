import { present } from './present.js';
import { and, eq } from 'drizzle-orm';
import {
  tenants,
  tenantMemberships,
  membershipPermissions,
  type Database,
} from '@lacquer/db';
import {
  permissions,
  hasPermission,
  type PermissionOverrides,
} from '@lacquer/types';
import type { TenantInput } from '@lacquer/schemas';
import { assertPermission, type TenantContext } from '../tenant-context.js';
import { notFound } from '../errors.js';
export function createTenantService(db: Database) {
  return {
    async list(userId: string) {
      const rows = await db
        .select({
          tenant: tenants,
          role: tenantMemberships.role,
          membershipId: tenantMemberships.id,
        })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .where(
          and(
            eq(tenantMemberships.userId, userId),
            eq(tenants.status, 'active'),
          ),
        )
        .orderBy(tenants.name);
      return Promise.all(
        rows.map(async (row) => {
          const toggles = await db
            .select()
            .from(membershipPermissions)
            .where(eq(membershipPermissions.membershipId, row.membershipId));
          const overrides: PermissionOverrides = {};
          for (const toggle of toggles)
            overrides[toggle.permission] = toggle.allowed;
          return {
            tenant: present(row.tenant),
            role: row.role,
            permissions: permissions.filter((p) =>
              hasPermission(row.role, p, overrides),
            ),
          };
        }),
      );
    },
    async create(userId: string, input: TenantInput) {
      return db.transaction(async (tx) => {
        const [tenant] = await tx.insert(tenants).values(input).returning();
        if (!tenant) throw new Error('Tenant insert failed');
        await tx
          .insert(tenantMemberships)
          .values({ userId, tenantId: tenant.id, role: 'owner' });
        return present(tenant);
      });
    },
    async get(context: TenantContext) {
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, context.tenantId));
      if (!tenant) throw notFound();
      return present(tenant);
    },
    async update(context: TenantContext, input: Partial<TenantInput>) {
      assertPermission(context, 'manage_business');
      const [tenant] = await db
        .update(tenants)
        .set(input)
        .where(eq(tenants.id, context.tenantId))
        .returning();
      if (!tenant) throw notFound();
      return present(tenant);
    },
  };
}

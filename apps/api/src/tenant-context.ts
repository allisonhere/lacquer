import { and, eq } from 'drizzle-orm';
import {
  tenantMemberships,
  tenants,
  membershipPermissions,
  type Database,
} from '@lacquer/db';
import { idSchema } from '@lacquer/schemas';
import {
  hasPermission,
  type Permission,
  type PermissionOverrides,
  type Role,
} from '@lacquer/types';
import { ApiFault, notFound } from './errors.js';
const validatedContext: unique symbol = Symbol('validatedTenantContext');
export interface TenantContext {
  readonly [validatedContext]: true;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
  readonly overrides: PermissionOverrides;
}
export function assertPermission(
  context: TenantContext,
  permission: Permission,
) {
  if (!hasPermission(context.role, permission, context.overrides))
    throw new ApiFault(
      403,
      'FORBIDDEN',
      'You do not have permission to perform this action.',
    );
}
export async function resolveTenantContext(
  db: Pick<Database, 'select'>,
  userId: string,
  rawTenantId: unknown,
): Promise<TenantContext> {
  const parsed = idSchema.safeParse(rawTenantId);
  if (!parsed.success)
    throw new ApiFault(400, 'INVALID_INPUT', 'Invalid tenant ID.');
  const [membership] = await db
    .select({ id: tenantMemberships.id, role: tenantMemberships.role })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, parsed.data),
        eq(tenants.status, 'active'),
      ),
    );
  // Hide tenant existence from non-members. Suspended tenants are inaccessible.
  if (!membership) throw notFound();
  const toggles = await db
    .select()
    .from(membershipPermissions)
    .where(eq(membershipPermissions.membershipId, membership.id));
  const overrides: PermissionOverrides = {};
  for (const toggle of toggles) overrides[toggle.permission] = toggle.allowed;
  return {
    [validatedContext]: true,
    tenantId: parsed.data,
    userId,
    role: membership.role,
    overrides,
  };
}

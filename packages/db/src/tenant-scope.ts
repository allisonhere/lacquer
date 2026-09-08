import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
/** Every tenant-owned query must include this predicate. Context is resolved by the API. */
export function tenantScope(
  tenantColumn: AnyPgColumn,
  tenantId: string,
  ...predicates: (SQL | undefined)[]
) {
  return and(eq(tenantColumn, tenantId), ...predicates);
}

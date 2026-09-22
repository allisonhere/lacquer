import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenantScope } from '@lacquer/db';
import { ApiFault, notFound } from '../errors.js';
import type { TenantContext } from '../tenant-context.js';
/**
 * Shared building blocks for the Milestone 2 resource services.
 *
 * The rule these encode: a tenant-owned row is only ever reached through a
 * predicate that already contains the authenticated tenant ID. There is no code
 * path that fetches by primary key alone and checks ownership afterwards,
 * because that ordering is what leaks data when someone forgets the second step.
 */
/** `tenant_id = $ctx AND id = $id` for a table whose own column is `id`. */
export function scopeById(
  tenantColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  context: TenantContext,
  id?: string,
): SQL | undefined {
  return tenantScope(
    tenantColumn,
    context.tenantId,
    id ? eq(idColumn, id) : undefined,
  );
}
/** The single row a caller asked for, or a 404 that does not reveal existence. */
export function requireOne<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (!row) throw notFound();
  return row;
}
/** Used after an insert whose failure would be a server bug rather than input. */
export function requireInserted<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (!row) throw new Error(`${what} insert returned no row`);
  return row;
}
export const conflict = (message: string) =>
  new ApiFault(409, 'CONFLICT', message);
export const invalid = (message: string) =>
  new ApiFault(400, 'INVALID_INPUT', message);
/**
 * Verify that every ID in `ids` belongs to this tenant, using one query.
 *
 * Composite foreign keys already make a cross-tenant write impossible at the
 * database level, but a raw FK violation surfaces as a generic 409. Checking
 * first turns "this skill belongs to another salon" into a clear 404 and keeps
 * the failure indistinguishable from "no such skill", which is what a tenant
 * boundary should look like from outside.
 */
export async function assertAllBelongToTenant(
  rows: Promise<{ id: string }[]>,
  ids: readonly string[],
): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = new Set((await rows).map((row) => row.id));
  if (unique.some((id) => !found.has(id))) throw notFound();
}
/** Convenience for the `where id in (...)` half of the check above. */
export function inTenant(
  tenantColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  tenantId: string,
  ids: readonly string[],
): SQL | undefined {
  return and(eq(tenantColumn, tenantId), inArray(idColumn, [...new Set(ids)]));
}
/** Group child rows by a parent key so a list endpoint stays a fixed query count. */
export function groupBy<T, K extends string>(
  rows: readonly T[],
  key: (row: T) => K,
): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}

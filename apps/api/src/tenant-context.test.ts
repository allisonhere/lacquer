import { describe, it, expect } from 'vitest';
import {
  tenantParamsSchema,
  locationCreateSchema,
  locationPatchSchema,
} from '@lacquer/schemas';
import { tenantScope, locations } from '@lacquer/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
describe('tenant context contracts', () => {
  it('rejects malformed and missing tenant IDs', () => {
    for (const tenantId of [undefined, '', 'not-a-uuid', "' OR 1=1 --"])
      expect(tenantParamsSchema.safeParse({ tenantId }).success).toBe(false);
  });
  it('rejects client-supplied ownership on create and update', () => {
    expect(
      locationCreateSchema.safeParse({
        name: 'Test',
        slug: 'test',
        timezone: 'UTC',
        tenantId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      locationPatchSchema.safeParse({ tenantId: crypto.randomUUID() }).success,
    ).toBe(false);
  });
  it('parameterizes tenant scope alongside resource ID', () => {
    const tenantId = crypto.randomUUID(),
      locationId = crypto.randomUUID();
    const predicate = tenantScope(
      locations.tenantId,
      tenantId,
      eq(locations.id, locationId),
    );
    if (!predicate) throw new Error('Missing scope predicate');
    const query = new PgDialect().sqlToQuery(predicate);
    expect(query.params).toEqual([tenantId, locationId]);
    expect(query.sql).toContain('"tenant_id" = $1');
    expect(query.sql).toContain('"id" = $2');
    expect(query.sql).not.toContain(tenantId);
  });
});

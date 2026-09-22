import { and, eq } from 'drizzle-orm';
import { tenants, type Database } from '@lacquer/db';
import { slugSchema } from '@lacquer/schemas';
import { notFound } from './errors.js';
const publicScope: unique symbol = Symbol('publicBookingScope');
export interface PublicBookingContext {
  readonly [publicScope]: true;
  readonly publicBooking: true;
  readonly tenantId: string;
  readonly slug: string;
}
export async function resolvePublicContext(
  db: Pick<Database, 'select'>,
  raw: string,
): Promise<PublicBookingContext> {
  const slug = slugSchema.parse(raw);
  const [row] = await db
    .select()
    .from(tenants)
    .where(
      and(
        eq(tenants.slug, slug),
        eq(tenants.status, 'active'),
        eq(tenants.publicBookingEnabled, true),
      ),
    );
  if (!row) throw notFound();
  return {
    [publicScope]: true,
    publicBooking: true,
    tenantId: row.id,
    slug: row.slug,
  };
}

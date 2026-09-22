import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase } from './index.js';
const raw = process.env.TEST_DATABASE_URL;
if (!raw || !new URL(raw).pathname.endsWith('_test'))
  throw Error('Use a dedicated TEST_DATABASE_URL ending in _test');
const url = new URL(raw),
  name = `lacquer_migration_${randomUUID().replaceAll('-', '')}_test`;
const admin = postgres(raw, { max: 1 });
let created = false;
try {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString());
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(
        new URL('../migrations', import.meta.url),
      ),
    });
    const rows = await database.db.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    const tables = await database.db.execute(
      sql`select count(*)::int as count from information_schema.tables where table_schema='public' and table_name in ('appointment_contacts','appointment_public_access')`,
    );
    if (Number(tables[0]?.count) !== 2)
      throw Error('Public booking tables missing');
    console.info(
      `Clean database: ${rows[0]?.count} migrations applied; both public booking tables verified.`,
    );
  } finally {
    await database.close();
  }
} finally {
  if (created) await admin.unsafe(`DROP DATABASE "${name}"`);
  await admin.end();
}

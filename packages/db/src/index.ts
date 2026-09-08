import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
export * from './schema.js';
export * from './tenant-scope.js';
export function createDatabase(url: string) {
  const client = postgres(url, {
    max: 10,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: { statement_timeout: 10000 },
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
export type Database = ReturnType<typeof createDatabase>['db'];

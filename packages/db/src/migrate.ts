import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { databaseConfigSchema } from '@lacquer/schemas';
import { createDatabase } from './index.js';
const config = databaseConfigSchema.parse(process.env);
const database = createDatabase(config.DATABASE_URL);
try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  console.info('Database migrations applied');
} finally {
  await database.close();
}

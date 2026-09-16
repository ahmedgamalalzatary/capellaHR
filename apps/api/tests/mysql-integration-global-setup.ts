import { createDatabase } from '@capella/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/database/migrations',
);

export default async function setup() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const database = createDatabase(databaseUrl);
    try {
      await migrate(database, { migrationsFolder });
    } finally {
      await database.$client.promise().end();
    }
  }

  return async () => {};
}

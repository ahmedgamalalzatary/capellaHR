import { createDatabase } from '@capella/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/database/migrations',
);

export default async function setup() {
  const sourceUrl = process.env.DATABASE_URL;
  if (sourceUrl) {
    const database = createDatabase(sourceUrl);
    try {
      await migrate(database, { migrationsFolder });
    } finally {
      await database.$client.promise().end();
    }
  }

  return async () => {
    const sharedUrl = process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL;
    if (!sourceUrl || !sharedUrl) return;

    const databaseName = new URL(sharedUrl).pathname.slice(1);
    if (!/^capella_hr_test_shared_\d+_\d+$/u.test(databaseName)) {
      throw new Error('Unsafe shared MySQL integration database name');
    }

    const control = createDatabase(sourceUrl);
    try {
      await control.$client.promise().query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    } finally {
      await control.$client.promise().end();
    }
  };
}

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
  const sharedUrl = process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL;
  const databaseName = sharedUrl ? new URL(sharedUrl).pathname.slice(1) : null;
  if (databaseName && !/^capella_hr_test_shared_\d+_\d+$/u.test(databaseName)) {
    throw new Error('Unsafe shared MySQL integration database name');
  }
  if (sourceUrl && sharedUrl && databaseName) {
    const control = createDatabase(sourceUrl);
    try {
      await control.$client.promise().query(
        `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } finally {
      await control.$client.promise().end();
    }
    const database = createDatabase(sharedUrl);
    try {
      await migrate(database, { migrationsFolder });
    } finally {
      await database.$client.promise().end();
    }
  }

  return async () => {
    if (!sourceUrl || !databaseName) return;

    const control = createDatabase(sourceUrl);
    try {
      await control.$client.promise().query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    } finally {
      await control.$client.promise().end();
    }
  };
}

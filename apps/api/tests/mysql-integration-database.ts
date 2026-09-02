import { createDatabase } from '@capella/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Database = ReturnType<typeof createDatabase>;

const sourceUrl = process.env.DATABASE_URL;
const sharedUrl = process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL;
if (!sourceUrl || !sharedUrl) throw new Error('MySQL integration database URLs are required');

const databaseName = new URL(sharedUrl).pathname.slice(1);
if (!/^capella_hr_test_shared_\d+_\d+$/u.test(databaseName)) {
  throw new Error('Unsafe shared MySQL integration database name');
}

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/database/migrations',
);

export const createMysqlIntegrationDatabase = () => createDatabase(sharedUrl);

const resetDatabase = async (database: Database) => {
  const connection = await database.$client.promise().getConnection();
  try {
    const [result] = await connection.query('SHOW FULL TABLES WHERE Table_type = \'BASE TABLE\'');
    const rows = result as Array<Record<string, string>>;
    const tables = rows
      .map((row) => Object.values(row)[0])
      .filter((name): name is string => typeof name === 'string' && name !== '__drizzle_migrations');

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) await connection.query(`TRUNCATE TABLE \`${table}\``);
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    connection.release();
  }
};

export const prepareMysqlIntegrationDatabase = async (database: Database) => {
  const control = createDatabase(sourceUrl);
  try {
    const [result] = await control.$client.promise().query(
      'SELECT 1 AS present FROM information_schema.schemata WHERE schema_name = ?',
      [databaseName],
    );
    const rows = result as Array<{ present: number }>;
    if (rows.length === 0) {
      await control.$client.promise().query(
        `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      await migrate(database, { migrationsFolder });
      return;
    }
    await resetDatabase(database);
  } finally {
    await control.$client.promise().end();
  }
};

export const closeMysqlIntegrationDatabase = async (database: Database) => {
  await database.$client.promise().end();
};

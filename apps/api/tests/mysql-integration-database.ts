import { createDatabase } from '@capella/database';

type Database = ReturnType<typeof createDatabase>;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('MySQL integration database URL is required');

export const createMysqlIntegrationDatabase = () => createDatabase(databaseUrl);

export const resetMysqlIntegrationDatabase = async (database: Database) => {
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
  await resetMysqlIntegrationDatabase(database);
};

export const closeMysqlIntegrationDatabase = async (database: Database) => {
  try {
    await resetMysqlIntegrationDatabase(database);
  } finally {
    await database.$client.promise().end();
  }
};

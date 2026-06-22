import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export type DatabaseClient = {
  db: MySql2Database<typeof schema>;
  pool: mysql.Pool;
  close: () => Promise<void>;
};

type CreateDatabaseClientOptions = {
  databaseUrl: string;
};

let databaseClient: DatabaseClient | null = null;

export function createDatabaseClient(options: CreateDatabaseClientOptions): DatabaseClient {
  if (databaseClient) {
    return databaseClient;
  }

  const pool = mysql.createPool({
    uri: options.databaseUrl,
    connectionLimit: 10
  });
  const db = drizzle({
    client: pool,
    schema,
    mode: "default"
  });

  databaseClient = {
    db,
    pool,
    async close() {
      await pool.end();

      if (databaseClient?.pool === pool) {
        databaseClient = null;
      }
    }
  };

  return databaseClient;
}

export async function resetDatabaseClient() {
  if (!databaseClient) {
    return;
  }

  await databaseClient.close();
}

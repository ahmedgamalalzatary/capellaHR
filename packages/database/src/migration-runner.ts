import { fileURLToPath, pathToFileURL } from 'node:url';

import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createConnection } from 'mysql2/promise';

import { reconcileDefiners, type DefinerReport } from './definer-reconciler.js';

interface OutputWriter {
  write(message: string): unknown;
}

interface MigrationRunnerOptions {
  migrate?: () => Promise<void>;
  now?: () => Date;
  reconcile?: () => Promise<DefinerReport>;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
}

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

function writeLog(output: OutputWriter, now: () => Date, message: string): void {
  output.write(`[${now().toISOString()}] [migrate] ${message}\n`);
}

async function migrateDatabase(): Promise<void> {
  const connectionUrl = process.env.DATABASE_URL;
  if (!connectionUrl) throw new Error('DATABASE_URL is not set');

  const connection = await createConnection(connectionUrl);
  try {
    await migrate(drizzle(connection), { migrationsFolder });
  } finally {
    await connection.end();
  }
}

/** Runs on the same credentials as the application, so repaired objects end up owned by it. */
async function reconcileConnectedDefiners(): Promise<DefinerReport> {
  const connectionUrl = process.env.DATABASE_URL;
  if (!connectionUrl) throw new Error('DATABASE_URL is not set');

  const { createConnection } = await import('mysql2/promise');
  const connection = await createConnection(connectionUrl);
  try {
    return await reconcileDefiners(async (sql) => {
      const [rows] = await connection.query(sql);
      return Array.isArray(rows) ? rows : [];
    });
  } finally {
    await connection.end();
  }
}

export async function runMigrations(options: MigrationRunnerOptions = {}): Promise<number> {
  const runMigration = options.migrate ?? migrateDatabase;
  const now = options.now ?? (() => new Date());
  const reconcile = options.reconcile ?? reconcileConnectedDefiners;
  const stderr = options.stderr ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;

  writeLog(stdout, now, 'Starting database migrations.');

  try {
    await runMigration();
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const reason = cause instanceof Error ? cause.message : String(cause);
    const code = cause && typeof cause === 'object' && 'code' in cause
      ? String(cause.code)
      : null;
    writeLog(stderr, now, `Database migrations failed: ${code ? `${code}: ` : ''}${reason}.`);
    if (error && typeof error === 'object' && 'query' in error && typeof error.query === 'string') {
      writeLog(stderr, now, `Failed SQL: ${error.query.replace(/\s+/g, ' ').trim()}`);
    }
    return 1;
  }

  try {
    const report = await reconcile();
    if (report.warning) {
      writeLog(stdout, now, `Skipped the database ownership check: ${report.warning}.`);
    } else {
      writeLog(
        stdout,
        now,
        report.repaired.length === 0
          ? `Every database trigger and routine belongs to an account this server has.`
          : `Reassigned ${report.repaired.length} database objects to ${report.account}: ${report.repaired.join(', ')}.`,
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeLog(
      stderr,
      now,
      `Could not reassign database objects to the application account: ${reason}.`,
    );
    return 1;
  }

  writeLog(stdout, now, 'Database migrations completed successfully.');
  return 0;
}

const entrypoint = process.argv[1];

if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = await runMigrations();
}

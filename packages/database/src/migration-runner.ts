import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { reconcileDefiners, type DefinerReport } from './definer-reconciler.js';

interface CommandResult {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
}

type ExecuteCommand = (
  command: string,
  args: string[],
  options: SpawnSyncOptions,
) => CommandResult;

interface OutputWriter {
  write(message: string): unknown;
}

interface MigrationRunnerOptions {
  execute?: ExecuteCommand;
  now?: () => Date;
  reconcile?: () => Promise<DefinerReport>;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
}

const databasePackageRoot = fileURLToPath(new URL('..', import.meta.url));

function writeLog(output: OutputWriter, now: () => Date, message: string): void {
  output.write(`[${now().toISOString()}] [migrate] ${message}\n`);
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
  const execute = options.execute ?? spawnSync;
  const now = options.now ?? (() => new Date());
  const reconcile = options.reconcile ?? reconcileConnectedDefiners;
  const stderr = options.stderr ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;

  writeLog(stdout, now, 'Starting database migrations.');

  const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = execute(packageManager, ['exec', 'drizzle-kit', 'migrate'], {
    cwd: databasePackageRoot,
    stdio: 'inherit',
    ...(process.platform === 'win32' ? { shell: true } : {}),
  });

  if (result.error) {
    writeLog(stderr, now, `Could not start Drizzle: ${result.error.message}.`);
    return 1;
  }

  if (result.status !== 0) {
    const failure = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.status ?? 'unknown'}`;
    writeLog(
      stderr,
      now,
      `Database migrations failed with ${failure}. Drizzle error output is shown above.`,
    );
    return result.status ?? 1;
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

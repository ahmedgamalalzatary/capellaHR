import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  stderr?: OutputWriter;
  stdout?: OutputWriter;
}

const databasePackageRoot = fileURLToPath(new URL('..', import.meta.url));

function writeLog(output: OutputWriter, now: () => Date, message: string): void {
  output.write(`[${now().toISOString()}] [migrate] ${message}\n`);
}

export function runMigrations(options: MigrationRunnerOptions = {}): number {
  const execute = options.execute ?? spawnSync;
  const now = options.now ?? (() => new Date());
  const stderr = options.stderr ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;

  writeLog(stdout, now, 'Starting database migrations.');

  const result = execute('pnpm', ['exec', 'drizzle-kit', 'migrate'], {
    cwd: databasePackageRoot,
    stdio: 'inherit',
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

  writeLog(stdout, now, 'Database migrations completed successfully.');
  return 0;
}

const entrypoint = process.argv[1];

if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = runMigrations();
}

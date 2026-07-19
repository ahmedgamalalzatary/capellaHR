import { describe, expect, it, vi } from 'vitest';

import { runMigrations } from './migration-runner.js';

const timestamp = new Date('2026-07-19T10:00:00.000Z');

describe('migration runner', () => {
  it('logs success and preserves the migration command output', () => {
    const execute = vi.fn(() => ({ signal: null, status: 0 }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = runMigrations({ execute, now: () => timestamp, stderr, stdout });

    expect(exitCode).toBe(0);
    expect(execute).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'drizzle-kit', 'migrate'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
    expect(stdout.write).toHaveBeenNthCalledWith(
      1,
      '[2026-07-19T10:00:00.000Z] [migrate] Starting database migrations.\n',
    );
    expect(stdout.write).toHaveBeenNthCalledWith(
      2,
      '[2026-07-19T10:00:00.000Z] [migrate] Database migrations completed successfully.\n',
    );
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it('logs the exit code and returns failure when Drizzle fails', () => {
    const execute = vi.fn(() => ({ signal: null, status: 23 }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = runMigrations({ execute, now: () => timestamp, stderr, stdout });

    expect(exitCode).toBe(23);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Database migrations failed with exit code 23. Drizzle error output is shown above.\n',
    );
  });

  it('logs command startup errors without exposing environment values', () => {
    const execute = vi.fn(() => ({
      error: new Error('spawn pnpm ENOENT'),
      signal: null,
      status: null,
    }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = runMigrations({ execute, now: () => timestamp, stderr, stdout });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Could not start Drizzle: spawn pnpm ENOENT.\n',
    );
  });
});

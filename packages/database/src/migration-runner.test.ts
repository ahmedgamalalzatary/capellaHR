import { describe, expect, it, vi } from 'vitest';

import { runMigrations } from './migration-runner.js';

const timestamp = new Date('2026-07-19T10:00:00.000Z');

const noRepairs = () => Promise.resolve({ account: 'capella_app@%', repaired: [] });

describe('migration runner', () => {
  it('logs success and preserves the migration command output', async () => {
    const execute = vi.fn(() => ({ signal: null, status: 0 }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = await runMigrations({
      execute, now: () => timestamp, stderr, stdout, reconcile: noRepairs,
    });

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
    expect(stdout.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Database migrations completed successfully.\n',
    );
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it('logs the exit code and returns failure when Drizzle fails', async () => {
    const execute = vi.fn(() => ({ signal: null, status: 23 }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = await runMigrations({
      execute, now: () => timestamp, stderr, stdout, reconcile: noRepairs,
    });

    expect(exitCode).toBe(23);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Database migrations failed with exit code 23. Drizzle error output is shown above.\n',
    );
  });

  it('logs command startup errors without exposing environment values', async () => {
    const execute = vi.fn(() => ({
      error: new Error('spawn pnpm ENOENT'),
      signal: null,
      status: null,
    }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = await runMigrations({
      execute, now: () => timestamp, stderr, stdout, reconcile: noRepairs,
    });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Could not start Drizzle: spawn pnpm ENOENT.\n',
    );
  });

  it('hands every trigger and routine to the migrating account after a successful migration', async () => {
    const execute = vi.fn(() => ({ signal: null, status: 0 }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const reconcile = vi.fn(() => Promise.resolve({
      account: 'capella_app@%',
      repaired: ['trigger erp_expenses_guard_insert', 'procedure correct_erp_expense'],
    }));

    const exitCode = await runMigrations({
      execute, now: () => timestamp, stderr, stdout, reconcile,
    });

    expect(exitCode).toBe(0);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(stdout.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Reassigned 2 database objects to capella_app@%: trigger erp_expenses_guard_insert, procedure correct_erp_expense.\n',
    );
  });

  it('skips the ownership pass when the migration itself failed', async () => {
    const execute = vi.fn(() => ({ signal: null, status: 7 }));
    const reconcile = vi.fn(noRepairs);

    const exitCode = await runMigrations({
      execute, now: () => timestamp, stderr: { write: vi.fn() }, stdout: { write: vi.fn() }, reconcile,
    });

    expect(exitCode).toBe(7);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('reports a skipped ownership pass without failing the migration', async () => {
    const execute = vi.fn(() => ({ signal: null, status: 0 }));
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const reconcile = vi.fn(() => Promise.resolve({
      account: 'capella_app@%',
      repaired: [],
      warning: 'could not read the server account list, so object ownership was left untouched',
    }));

    const exitCode = await runMigrations({
      execute, now: () => timestamp, stderr, stdout, reconcile,
    });

    expect(exitCode).toBe(0);
    expect(stdout.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Skipped the database ownership check: could not read the server account list, so object ownership was left untouched.\n',
    );
  });

  it('fails the migration when database objects cannot be reassigned', async () => {
    const execute = vi.fn(() => ({ signal: null, status: 0 }));
    const stderr = { write: vi.fn() };
    const reconcile = vi.fn(() => Promise.reject(new Error('access denied')));

    const exitCode = await runMigrations({
      execute, now: () => timestamp, stderr, stdout: { write: vi.fn() }, reconcile,
    });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Could not reassign database objects to the application account: access denied.\n',
    );
  });
});

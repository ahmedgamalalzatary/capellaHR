import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../src/migration-runner.js';

const timestamp = new Date('2026-07-19T10:00:00.000Z');

const noRepairs = () => Promise.resolve({ account: 'capella_app@%', repaired: [] });

describe('migration runner', () => {
  it('logs success after applying migrations and checking database ownership', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = await runMigrations({
      migrate: () => Promise.resolve(), now: () => timestamp, stderr, stdout, reconcile: noRepairs,
    });

    expect(exitCode).toBe(0);
    expect(stdout.write).toHaveBeenNthCalledWith(
      1,
      '[2026-07-19T10:00:00.000Z] [migrate] Starting database migrations.\n',
    );
    expect(stdout.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Database migrations completed successfully.\n',
    );
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it('logs a migration failure without SQL context', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const exitCode = await runMigrations({
      migrate: () => Promise.reject(new Error('connect ECONNREFUSED')),
      now: () => timestamp, stderr, stdout, reconcile: noRepairs,
    });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Database migrations failed: connect ECONNREFUSED.\n',
    );
  });

  it('prints the database reason and failed SQL when a migration fails', async () => {
    const cause = Object.assign(new Error('Invalid use of NULL value'), {
      code: 'ER_INVALID_USE_OF_NULL',
    });
    const failure = new DrizzleQueryError(
      'ALTER TABLE `erp_service_queue_entries` MODIFY `employee_id` int NOT NULL;',
      [],
      cause,
    );
    const stderr = { write: vi.fn() };
    const reconcile = vi.fn(noRepairs);

    const exitCode = await runMigrations({
      migrate: () => Promise.reject(failure),
      now: () => timestamp,
      stderr,
      stdout: { write: vi.fn() },
      reconcile,
    });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Database migrations failed: ER_INVALID_USE_OF_NULL: Invalid use of NULL value.\n',
    );
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Failed SQL: ALTER TABLE `erp_service_queue_entries` MODIFY `employee_id` int NOT NULL;\n',
    );
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('hands every trigger and routine to the migrating account after a successful migration', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const reconcile = vi.fn(() => Promise.resolve({
      account: 'capella_app@%',
      repaired: ['trigger erp_expenses_guard_insert', 'procedure correct_erp_expense'],
    }));

    const exitCode = await runMigrations({
      migrate: () => Promise.resolve(), now: () => timestamp, stderr, stdout, reconcile,
    });

    expect(exitCode).toBe(0);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(stdout.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Reassigned 2 database objects to capella_app@%: trigger erp_expenses_guard_insert, procedure correct_erp_expense.\n',
    );
  });

  it('skips the ownership pass when the migration itself failed', async () => {
    const reconcile = vi.fn(noRepairs);

    const exitCode = await runMigrations({
      migrate: () => Promise.reject(new Error('migration failed')),
      now: () => timestamp, stderr: { write: vi.fn() }, stdout: { write: vi.fn() }, reconcile,
    });

    expect(exitCode).toBe(1);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('reports a skipped ownership pass without failing the migration', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const reconcile = vi.fn(() => Promise.resolve({
      account: 'capella_app@%',
      repaired: [],
      warning: 'could not read the server account list, so object ownership was left untouched',
    }));

    const exitCode = await runMigrations({
      migrate: () => Promise.resolve(), now: () => timestamp, stderr, stdout, reconcile,
    });

    expect(exitCode).toBe(0);
    expect(stdout.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Skipped the database ownership check: could not read the server account list, so object ownership was left untouched.\n',
    );
  });

  it('fails the migration when database objects cannot be reassigned', async () => {
    const stderr = { write: vi.fn() };
    const reconcile = vi.fn(() => Promise.reject(new Error('access denied')));

    const exitCode = await runMigrations({
      migrate: () => Promise.resolve(),
      now: () => timestamp, stderr, stdout: { write: vi.fn() }, reconcile,
    });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      '[2026-07-19T10:00:00.000Z] [migrate] Could not reassign database objects to the application account: access denied.\n',
    );
  });
});

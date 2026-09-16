import { describe, expect, it } from 'vitest';

describe('test environment isolation', () => {
  it('loads test mode from the root .env.test file', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('uses the database configured in the root .env.test file', () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');

    // A git worktree may point at its own suffixed test database
    // (capella_hr-test-<slice>) so parallel branches never share one MySQL
    // schema. It must still be a test database, and never the development one.
    expect(databaseUrl.pathname).toMatch(/^\/capella_hr-test(?:-[\w-]+)?$/);
    expect(databaseUrl.pathname).not.toBe('/capella_hr');
  });
});

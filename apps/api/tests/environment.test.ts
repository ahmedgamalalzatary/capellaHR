import { describe, expect, it } from 'vitest';

describe('test environment isolation', () => {
  it('loads test mode from the root .env.test file', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('refuses to use the development database during tests', () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');

    expect(databaseUrl.pathname).toBe('/capella_hr-test');
    expect(databaseUrl.pathname).not.toBe('/capella_hr');
  });
});

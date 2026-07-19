import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

describe('server environment', () => {
  it('accepts a plain admin password instead of an Argon2 hash', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost/capella_hr-test');
    vi.stubEnv('ADMIN_EMAIL', 'admin@capella.test');
    vi.stubEnv('ADMIN_PASSWORD', 'plain-admin-password');
    const { parseServerEnv } = await import('./server.js');
    const env = parseServerEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://user:password@localhost/capella_hr-test',
      ADMIN_EMAIL: 'admin@capella.test',
      ADMIN_PASSWORD: 'plain-admin-password',
    });

    expect(env.ADMIN_PASSWORD).toBe('plain-admin-password');
    expect(env).not.toHaveProperty('ADMIN_PASSWORD_HASH');
  });

  it('rejects insecure production origins and unrelated WebAuthn RP IDs', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };
    expect(() => parseServerEnv({ ...base, NODE_ENV: 'production', WEB_ORIGIN: 'http://hr.example.com' })).toThrow();
    expect(() => parseServerEnv({ ...base, WEB_ORIGIN: 'https://hr.example.com', WEBAUTHN_RP_ID: 'attacker.example.net' })).toThrow();
    expect(parseServerEnv({ ...base, WEB_ORIGIN: 'https://hr.example.com', WEBAUTHN_RP_ID: 'example.com' }).WEBAUTHN_RP_ID).toBe('example.com');
  });

  it('rejects ports outside the TCP range', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };

    expect(() => parseServerEnv({ ...base, API_PORT: '65536' })).toThrow();
  });

  it('normalizes WEB_ORIGIN to an origin-only value', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };

    expect(parseServerEnv({ ...base, WEB_ORIGIN: 'https://hr.example.com/' }).WEB_ORIGIN).toBe('https://hr.example.com');
    expect(parseServerEnv({ ...base, WEB_ORIGIN: 'https://hr.example.com/admin' }).WEB_ORIGIN).toBe('https://hr.example.com');
    expect(() => parseServerEnv({ ...base, WEB_ORIGIN: 'data:text/plain,x' })).toThrow(ZodError);
  });

  it('accepts only a bounded explicit trusted-proxy hop count', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };

    expect(parseServerEnv({ ...base }).TRUST_PROXY_HOPS).toBeUndefined();
    expect(parseServerEnv({ ...base, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    expect(() => parseServerEnv({ ...base, TRUST_PROXY_HOPS: '0' })).toThrow();
    expect(() => parseServerEnv({ ...base, TRUST_PROXY_HOPS: '11' })).toThrow();
  });

  it('parses backend-owned display settings and employee upload limits', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };

    expect(parseServerEnv({
      ...base,
      APP_TIME_ZONE: 'Africa/Cairo',
      APP_LOCALE: 'ar-EG-u-nu-latn',
      MAX_EMPLOYEE_IMAGE_BYTES: '16777216',
    })).toMatchObject({
      APP_TIME_ZONE: 'Africa/Cairo',
      APP_LOCALE: 'ar-EG-u-nu-latn',
      MAX_EMPLOYEE_IMAGE_BYTES: 16_777_216,
    });
  });

  it('rejects display settings outside the locked Cairo and Arabic product configuration', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };

    expect(() => parseServerEnv({ ...base, APP_TIME_ZONE: 'Not/AZone' })).toThrow();
    expect(() => parseServerEnv({ ...base, APP_TIME_ZONE: 'UTC' })).toThrow(
      'APP_TIME_ZONE must be Africa/Cairo',
    );
    expect(() => parseServerEnv({ ...base, APP_LOCALE: 'not_a_locale' })).toThrow(
      'APP_LOCALE must be ar-EG-u-nu-latn',
    );
    expect(() => parseServerEnv({ ...base, APP_LOCALE: 'en-US' })).toThrow(
      'APP_LOCALE must be ar-EG-u-nu-latn',
    );
  });

  it('rejects upload limits above the database ceiling', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };

    expect(() => parseServerEnv({ ...base, MAX_EMPLOYEE_IMAGE_BYTES: '16777217' })).toThrow();
  });

  it('parses bounded report-worker polling and optional shared storage settings', async () => {
    const { parseServerEnv } = await import('./server.js');
    const base = { DATABASE_URL: 'mysql://user:password@localhost/capella_hr', ADMIN_EMAIL: 'admin@capella.test', ADMIN_PASSWORD: 'password' };

    expect(parseServerEnv(base)).toMatchObject({ REPORT_WORKER_POLL_MS: 2_000 });
    expect(parseServerEnv({
      ...base,
      REPORT_WORKER_POLL_MS: '500',
      REPORT_FILES_ROOT: '/app/uploads/reports',
    })).toMatchObject({
      REPORT_WORKER_POLL_MS: 500,
      REPORT_FILES_ROOT: '/app/uploads/reports',
    });
    expect(() => parseServerEnv({ ...base, REPORT_WORKER_POLL_MS: '99' })).toThrow();
    expect(() => parseServerEnv({ ...base, REPORT_WORKER_POLL_MS: '60001' })).toThrow();
  });

  it('parses worker settings without accepting admin or WebAuthn credentials', async () => {
    const { parseWorkerEnv } = await import('./worker.js');
    const parsed = parseWorkerEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://user:password@db/capella_hr',
      APP_TIME_ZONE: 'Africa/Cairo',
      REPORT_FILES_ROOT: '/app/uploads/reports',
      ADMIN_EMAIL: 'must-not-enter-worker@capella.test',
      ADMIN_PASSWORD: 'must-not-enter-worker',
      WEBAUTHN_RP_ID: 'must-not-enter-worker.test',
    });

    expect(parsed).toMatchObject({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://user:password@db/capella_hr',
      APP_TIME_ZONE: 'Africa/Cairo',
      REPORT_FILES_ROOT: '/app/uploads/reports',
    });
    expect(parsed).not.toHaveProperty('ADMIN_EMAIL');
    expect(parsed).not.toHaveProperty('ADMIN_PASSWORD');
    expect(parsed).not.toHaveProperty('WEBAUTHN_RP_ID');
  });
});

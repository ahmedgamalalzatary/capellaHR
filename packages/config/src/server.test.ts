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
});

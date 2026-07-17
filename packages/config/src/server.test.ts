import { describe, expect, it, vi } from 'vitest';

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
});

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('POS frontend edition boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('proxies the same-origin API path to the private API runtime', async () => {
    vi.stubEnv('EDITION', 'full');
    vi.stubEnv('API_PROXY_TARGET', 'http://api:4000');

    const config = (await import('../next.config.js')).default;

    await expect(config.rewrites?.()).resolves.toContainEqual({
      source: '/api/:path*',
      destination: 'http://api:4000/api/:path*',
    });
  });

  it('rejects an HR-only build before exposing POS routes', async () => {
    vi.stubEnv('EDITION', 'hr');

    await expect(import('../next.config.js')).rejects.toThrow(
      'The POS frontend is not available in EDITION="hr".',
    );
  });
});

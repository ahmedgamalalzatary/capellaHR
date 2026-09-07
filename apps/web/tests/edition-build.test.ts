import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateInitialEnv } from '@next/env';

describe('HR frontend edition boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    updateInitialEnv({ EDITION: process.env.EDITION, API_PROXY_TARGET: process.env.API_PROXY_TARGET });
    vi.resetModules();
  });

  it('proxies the same-origin API path to the private API runtime', async () => {
    vi.stubEnv('EDITION', 'full');
    vi.stubEnv('API_PROXY_TARGET', 'http://api:4000');
    updateInitialEnv({ EDITION: 'full', API_PROXY_TARGET: 'http://api:4000' });

    const config = (await import('../next.config.js')).default;

    await expect(config.rewrites?.()).resolves.toContainEqual({
      source: '/api/:path*',
      destination: 'http://api:4000/api/:path*',
    });
  });

  it('builds the attendance surface for an ERP-only deployment', async () => {
    vi.stubEnv('EDITION', 'erp');
    updateInitialEnv({ EDITION: 'erp' });

    const config = (await import('../next.config.js')).default;
    expect(config.env).toMatchObject({ NEXT_PUBLIC_CAPELLA_EDITION: 'erp' });
  });
});

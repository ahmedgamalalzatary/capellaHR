import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('publicEnv', () => {
  test('exposes NEXT_PUBLIC_API_URL when it is a valid URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000/api/v1');

    const { publicEnv } = await import('./client.js');

    expect(publicEnv.NEXT_PUBLIC_API_URL).toBe('http://localhost:4000/api/v1');
  });

  test('rejects a malformed NEXT_PUBLIC_API_URL at load time', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'not-a-url');

    await expect(import('./client.js')).rejects.toThrow();
  });
});

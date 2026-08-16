import { describe, expect, it } from 'vitest';

import { resolveApiProxyTarget } from '../src/proxy.js';

describe('API proxy target', () => {
  it('defaults local frontend development to the local API origin', () => {
    const previous = process.env.API_PROXY_TARGET;
    delete process.env.API_PROXY_TARGET;
    try {
      expect(resolveApiProxyTarget(undefined)).toBe('http://localhost:4000');
    } finally {
      if (previous === undefined) delete process.env.API_PROXY_TARGET;
      else process.env.API_PROXY_TARGET = previous;
    }
  });

  it.each([
    'ftp://api.example.com',
    'http://user:password@api:4000',
    'http://api:4000/api/v1',
    'http://api:4000?target=other',
    'http://api:4000#fragment',
  ])('rejects a non-origin proxy target: %s', (target) => {
    expect(() => resolveApiProxyTarget(target)).toThrow(
      'API_PROXY_TARGET must be an HTTP(S) origin without credentials or a path',
    );
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { POST } from '../src/app/protected-area-access/route';

const originalPassword = process.env['PROTECTED_TAB_PASSWORD'];

afterEach(() => {
  if (originalPassword === undefined) {
    delete process.env['PROTECTED_TAB_PASSWORD'];
  } else {
    process.env['PROTECTED_TAB_PASSWORD'] = originalPassword;
  }
});

describe('POST /protected-area-access', () => {
  it('accepts the configured password', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';

    const response = await POST(new Request('http://localhost/protected-area-access', {
      method: 'POST',
      body: JSON.stringify({ password: 'Cap2255' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unlocked: true });
  });

  it('rejects a wrong password', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';

    const response = await POST(new Request('http://localhost/protected-area-access', {
      method: 'POST',
      body: JSON.stringify({ password: 'wrong' }),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'INVALID_PASSWORD' });
  });

  it('fails closed when no password is configured', async () => {
    delete process.env['PROTECTED_TAB_PASSWORD'];

    const response = await POST(new Request('http://localhost/protected-area-access', {
      method: 'POST',
      body: JSON.stringify({ password: 'anything' }),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'NOT_CONFIGURED' });
  });
});

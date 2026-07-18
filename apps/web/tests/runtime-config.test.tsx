import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { CairoClock } from '../src/components/shell/cairo-clock';
import { AppProviders } from '../src/providers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('runtime display configuration', () => {
  test('loads locale and time zone from the public API before rendering the clock', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { locale: 'ar-EG-u-nu-latn', timeZone: 'Africa/Cairo' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <AppProviders>
        <CairoClock />
      </AppProviders>,
    );

    expect(container.querySelector('time')).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/config',
      expect.objectContaining({ credentials: 'include' }),
    ));
    await waitFor(() => expect(container.querySelector('time')).not.toBeNull());
  });
});

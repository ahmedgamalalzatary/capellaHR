import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

import HomePage from '../src/app/page';

describe('public home page', () => {
  it('opens the branch attendance kiosk by default', () => {
    HomePage();
    expect(redirect).toHaveBeenCalledWith('/branch-kiosk');
  });
});

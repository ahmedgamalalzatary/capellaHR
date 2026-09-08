import { expect, test, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

import ServicesPage from '../src/app/(protected)/services/page';

test('sends leftover /services traffic to the catalog', () => {
  try {
    ServicesPage();
  } catch {
    // next/navigation redirect aborts rendering
  }
  expect(redirect).toHaveBeenCalledWith('/catalog');
});

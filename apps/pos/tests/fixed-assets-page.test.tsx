import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/fixed-assets', () => ({
  FixedAssetsView: () => null,
}));

import FixedAssetsPage from '../src/app/(protected)/fixed-assets/page';

describe('fixed assets page', () => {
  /** The register is the admin's own note about branch property. */
  it('admits admins only', () => {
    expect(FixedAssetsPage().props.role).toBe('admin');
  });
});

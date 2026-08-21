import { describe, expect, it } from 'vitest';

import {
  createFixedAssetSchema,
  listFixedAssetsQuerySchema,
  updateFixedAssetSchema,
} from '../../../../src/modules/erp/fixed-assets/index.js';

const minimal = { branchId: 2, name: 'كرسي انتظار' };

describe('fixed asset contracts', () => {
  it('accepts a line carrying nothing but its name, because every detail is the admin\'s choice', () => {
    expect(createFixedAssetSchema.parse(minimal)).toMatchObject({ name: 'كرسي انتظار' });
  });

  it('keeps the unit price exact and normalizes a sloppily typed one', () => {
    expect(createFixedAssetSchema.parse({ ...minimal, unitPrice: '01200.5' }).unitPrice).toBe('1200.50');
    expect(createFixedAssetSchema.parse({ ...minimal, unitPrice: '0' }).unitPrice).toBe('0.00');
  });

  it('refuses a nameless line and a name of nothing but spaces', () => {
    expect(createFixedAssetSchema.safeParse({ branchId: 2 }).success).toBe(false);
    expect(createFixedAssetSchema.safeParse({ ...minimal, name: '   ' }).success).toBe(false);
  });

  it.each(['-1', '1.5', 'NaN'])('refuses quantity %s, which no counted thing can have', (quantity) => {
    expect(createFixedAssetSchema.safeParse({ ...minimal, quantity }).success).toBe(false);
  });

  it.each(['-1.00', '1.001', 'x'])('refuses unit price %s', (unitPrice) => {
    expect(createFixedAssetSchema.safeParse({ ...minimal, unitPrice }).success).toBe(false);
  });

  it('accepts the optional detail the admin may or may not write down', () => {
    const parsed = createFixedAssetSchema.parse({
      ...minimal,
      quantity: 10,
      unitPrice: '350.00',
      location: 'الاستقبال',
      note: 'لون بيج',
      purchasedOn: '2026-03-01',
      condition: 'needs_repair',
    });

    expect(parsed).toMatchObject({ quantity: 10, location: 'الاستقبال', condition: 'needs_repair' });
  });

  it.each(['2026-02-30', '2026-3-01', 'yesterday'])('refuses purchase date %s', (purchasedOn) => {
    expect(createFixedAssetSchema.safeParse({ ...minimal, purchasedOn }).success).toBe(false);
  });

  it('refuses a condition it does not know', () => {
    expect(createFixedAssetSchema.safeParse({ ...minimal, condition: 'rusty' }).success).toBe(false);
  });

  it('lets an edit clear a detail that was written down by mistake', () => {
    expect(updateFixedAssetSchema.parse({ branchId: 2, name: 'كرسي', note: '', purchasedOn: null }))
      .toMatchObject({ note: '', purchasedOn: null });
  });

  it('lists with paging and an optional search, and refuses an unknown filter', () => {
    expect(listFixedAssetsQuerySchema.parse({ branchId: 2 })).toMatchObject({ page: 1, pageSize: 20 });
    expect(listFixedAssetsQuerySchema.parse({ search: 'كرسي' }).search).toBe('كرسي');
    expect(listFixedAssetsQuerySchema.safeParse({ sortBy: 'price' }).success).toBe(false);
  });
});

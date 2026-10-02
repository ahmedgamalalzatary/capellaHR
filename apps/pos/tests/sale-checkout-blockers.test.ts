import { describe, expect, it } from 'vitest';

import { saleCheckoutBlockers } from '../src/features/sales/components/sale-primitives';

const ready = {
  hasClient: true,
  hasLines: true,
  linesAssigned: true,
  servicePricesValid: true,
  quoteReady: true,
  remaining: BigInt(0),
  hasServiceLines: true,
};

describe('saleCheckoutBlockers', () => {
  it('explains an invalid batch allocation independently of employee assignment', () => {
    const state = { ...ready, batchSelectionsValid: false };
    expect(saleCheckoutBlockers(state)).toEqual(['راجع اختيار وكميات دفعات المنتجات']);
  });
  it('lists every missing till field so Complete is never silent', () => {
    expect(saleCheckoutBlockers({
      hasClient: false,
      hasLines: false,
      linesAssigned: true,
      servicePricesValid: true,
      quoteReady: false,
      remaining: null,
      hasServiceLines: false,
    })).toEqual(['اختر العميل', 'أضف خدمة أو منتجًا']);
  });

  it('names an unassigned service and an open price before payment', () => {
    expect(saleCheckoutBlockers({
      ...ready,
      linesAssigned: false,
      servicePricesValid: false,
      quoteReady: false,
      remaining: null,
    })).toEqual([
      'أدخل سعرًا صالحًا لكل خدمة مفتوحة السعر',
      'عيّن موظفًا لكل بند',
    ]);
  });

  it('requires full payment on a service ticket and rejects overpay', () => {
    expect(saleCheckoutBlockers({ ...ready, remaining: BigInt(100) }))
      .toEqual(['سدد إجمالي الخدمات بالكامل']);
    expect(saleCheckoutBlockers({ ...ready, remaining: BigInt(-50) }))
      .toEqual(['المدفوع أكبر من الإجمالي']);
  });

  it('allows a product-only ticket to stay open on account', () => {
    expect(saleCheckoutBlockers({
      ...ready,
      hasServiceLines: false,
      remaining: BigInt(50),
    })).toEqual([]);
  });
});

it('blocks product checkout until every product has an assigned employee', () => {
  expect(saleCheckoutBlockers({ ...ready, hasServiceLines: false, linesAssigned: false }))
    .toEqual(['عيّن موظفًا لكل بند']);
});

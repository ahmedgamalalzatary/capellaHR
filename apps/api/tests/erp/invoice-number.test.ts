import { describe, expect, it } from 'vitest';

import {
  cairoBusinessDate,
  createInvoiceNumberAllocator,
  formatInvoiceNumber,
} from '../../src/modules/erp/sales/services/invoice-number.js';

describe('ERP invoice numbering', () => {
  it('formats a globally allocated sequence with at least six digits', () => {
    const instant = new Date('2026-08-03T22:30:00.000Z');
    expect(cairoBusinessDate(instant)).toBe('2026-08-04');
    expect(formatInvoiceNumber(instant, 17)).toBe('000017');
    expect(formatInvoiceNumber(instant, 1_000_000)).toBe('1000000');
  });

  it('rejects sequence values outside the positive MySQL INT range', () => {
    const instant = new Date('2026-08-03T08:00:00.000Z');
    expect(() => formatInvoiceNumber(instant, 0)).toThrow('Invalid invoice sequence value');
    expect(() => formatInvoiceNumber(instant, 2147483648)).toThrow(
      'Invalid invoice sequence value',
    );
  });

  it('durably allocates a global number before formatting it', async () => {
    const calls: Array<{ allocatedAt: Date }> = [];
    const instant = new Date('2026-08-03T22:30:00.000Z');
    const allocator = createInvoiceNumberAllocator({
      allocate(allocatedAt) {
        calls.push({ allocatedAt });
        return Promise.resolve(17);
      },
    }, () => instant);

    await expect(allocator.allocate()).resolves.toEqual({
      businessDate: '2026-08-04',
      sequence: 17,
      invoiceNumber: '000017',
      allocatedAt: instant,
    });
    expect(calls).toEqual([{ allocatedAt: instant }]);
  });

  it('keeps increasing across Cairo business dates', async () => {
    let next = 0;
    let now = new Date('2026-08-03T20:59:00.000Z');
    const allocator = createInvoiceNumberAllocator({
      allocate: async () => ++next,
    }, () => now);

    await expect(allocator.allocate()).resolves.toMatchObject({ invoiceNumber: '000001' });
    now = new Date('2026-08-03T21:01:00.000Z');
    await expect(allocator.allocate()).resolves.toMatchObject({ invoiceNumber: '000002' });
  });
});

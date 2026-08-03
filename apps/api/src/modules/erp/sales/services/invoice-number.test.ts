import { describe, expect, it } from 'vitest';

import {
  cairoBusinessDate,
  createInvoiceNumberAllocator,
  formatInvoiceNumber,
} from './invoice-number.js';

describe('ERP invoice numbering', () => {
  it('derives the business date and display time in Africa/Cairo', () => {
    const instant = new Date('2026-08-03T22:30:00.000Z');
    expect(cairoBusinessDate(instant)).toBe('2026-08-04');
    expect(formatInvoiceNumber(instant, 17)).toBe('INV-2026.08.04-01.30-17');
  });

  it('rejects sequence values outside the positive MySQL INT range', () => {
    const instant = new Date('2026-08-03T08:00:00.000Z');
    expect(() => formatInvoiceNumber(instant, 0)).toThrow('Invalid invoice sequence value');
    expect(() => formatInvoiceNumber(instant, 2147483648)).toThrow(
      'Invalid invoice sequence value',
    );
  });

  it('durably allocates by Cairo business date before formatting the number', async () => {
    const calls: Array<{ businessDate: string; allocatedAt: Date }> = [];
    const instant = new Date('2026-08-03T22:30:00.000Z');
    const allocator = createInvoiceNumberAllocator({
      allocate(businessDate, allocatedAt) {
        calls.push({ businessDate, allocatedAt });
        return Promise.resolve(17);
      },
    }, () => instant);

    await expect(allocator.allocate()).resolves.toEqual({
      businessDate: '2026-08-04',
      sequence: 17,
      invoiceNumber: 'INV-2026.08.04-01.30-17',
      allocatedAt: instant,
    });
    expect(calls).toEqual([{ businessDate: '2026-08-04', allocatedAt: instant }]);
  });
});

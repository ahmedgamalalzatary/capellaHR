import { describe, expect, it } from 'vitest';
import * as stock from '../../../../src/modules/erp/stock/index.ts';

type Allocation = { batchId: number; expiryDate: string | null; quantity: string };
const allocate = (available: Allocation[], quantity: string, selected?: Array<{ batchId: number; quantity: string }>) => {
  const fn = Reflect.get(stock, 'allocateBatchQuantities');
  expect(fn).toBeTypeOf('function');
  return fn(available, quantity, selected);
};
const batches = [
  { batchId: 1, expiryDate: null, quantity: '8.000' },
  { batchId: 2, expiryDate: '2027-05-01', quantity: '2.000' },
  { batchId: 3, expiryDate: '2026-01-01', quantity: '1.500' },
];
describe('batch allocation', () => {
  it('ignores unavailable rows when a basket already reserved more than their balance', () => {
    expect(allocate([
      { batchId: 1, expiryDate: '2027-01-01', quantity: '-1.000' },
      { batchId: 2, expiryDate: '2027-02-01', quantity: '2.000' },
    ], '1.000')).toEqual([{ batchId: 2, expiryDate: '2027-02-01', quantity: '1.000' }]);
  });
  it('requires manually selected quantities to match the demand before submitting', () => {
    const valid = Reflect.get(stock, 'isBatchSelectionComplete');
    expect(valid).toBeTypeOf('function');
    expect(valid([{ batchId: 1, quantity: '1.000' }], '2.000', true)).toBe(false);
    expect(valid([{ batchId: 1, quantity: '0.500' }, { batchId: 2, quantity: '0.500' }], '1.000', true)).toBe(false);
    expect(valid([{ batchId: 1, quantity: '0.500' }], '0.500', false)).toBe(true);
  });
  it('uses earliest expiry including expired stock and splits quantities before unknown stock', () => {
    expect(allocate(batches, '4.000')).toEqual([
      { batchId: 3, expiryDate: '2026-01-01', quantity: '1.500' },
      { batchId: 2, expiryDate: '2027-05-01', quantity: '2.000' },
      { batchId: 1, expiryDate: null, quantity: '0.500' },
    ]);
  });
  it('honors staff selection rather than silently selecting a different batch', () => {
    expect(allocate(batches, '2.000', [{ batchId: 1, quantity: '2.000' }])).toEqual([
      { batchId: 1, expiryDate: null, quantity: '2.000' },
    ]);
  });
  it('rejects duplicate, foreign, insufficient or incomplete allocations', () => {
    for (const selected of [
      [{ batchId: 1, quantity: '1.000' }, { batchId: 1, quantity: '1.000' }],
      [{ batchId: 99, quantity: '2.000' }],
      [{ batchId: 3, quantity: '2.000' }],
      [{ batchId: 1, quantity: '1.000' }],
    ]) expect(() => allocate(batches, '2.000', selected)).toThrow();
  });
  it('keeps fractional consumable quantities exact', () => {
    expect(allocate([{ batchId: 1, expiryDate: null, quantity: '0.300' }], '0.100')[0]?.quantity).toBe('0.100');
  });
});

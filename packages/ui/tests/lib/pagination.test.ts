import { describe, expect, test } from 'vitest';

import { getVisiblePages } from '../../src/lib/pagination';

describe('getVisiblePages', () => {
  test('returns every page when total fits the window', () => {
    expect(getVisiblePages(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test('always keeps first, last, and current neighbours visible', () => {
    expect(getVisiblePages(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
  });

  test('clamps near the start and end', () => {
    expect(getVisiblePages(1, 10)).toEqual([1, 2, 3, '…', 10]);
    expect(getVisiblePages(10, 10)).toEqual([1, '…', 8, 9, 10]);
  });
});

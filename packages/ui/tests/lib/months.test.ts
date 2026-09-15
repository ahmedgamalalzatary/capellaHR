import { describe, expect, test } from 'vitest';

import {
  AR_MONTH_NAMES,
  formatMonthValue,
  isValidMonthValue,
  parseMonthValue,
} from '../../src/lib/months';

describe('month helpers', () => {
  test('exposes twelve Arabic month names', () => {
    expect(AR_MONTH_NAMES).toHaveLength(12);
    expect(AR_MONTH_NAMES[0]).toBe('يناير');
    expect(AR_MONTH_NAMES[7]).toBe('أغسطس');
    expect(AR_MONTH_NAMES[11]).toBe('ديسمبر');
  });

  test('formats a YYYY-MM value as an Arabic month label', () => {
    expect(formatMonthValue('2026-08')).toBe('أغسطس 2026');
    expect(formatMonthValue('')).toBe('');
    expect(formatMonthValue('oops')).toBe('oops');
  });

  test('parses a YYYY-MM value into year and month', () => {
    expect(parseMonthValue('2026-08')).toEqual({ year: 2026, month: 8 });
    expect(parseMonthValue('')).toBeNull();
    expect(parseMonthValue('2026-13')).toBeNull();
    expect(parseMonthValue('2026-8')).toBeNull();
  });

  test('validates YYYY-MM values', () => {
    expect(isValidMonthValue('2026-01')).toBe(true);
    expect(isValidMonthValue('2026-12')).toBe(true);
    expect(isValidMonthValue('')).toBe(false);
    expect(isValidMonthValue('2026-00')).toBe(false);
    expect(isValidMonthValue('26-08')).toBe(false);
  });
});

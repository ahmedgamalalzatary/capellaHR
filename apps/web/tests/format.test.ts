import { describe, expect, test } from 'vitest';

import {
  formatCairoDate,
  formatCairoTime,
  formatDuration,
  formatMoney,
} from '../src/lib/utils/format';

describe('formatMoney', () => {
  test('renders EGP with two decimals and Western digits', () => {
    expect(formatMoney(1234.5)).toBe('1,234.50 ج.م');
  });

  test('accepts decimal strings from the API', () => {
    expect(formatMoney('99.999')).toBe('100.00 ج.م');
  });
});

describe('formatDuration', () => {
  test('renders whole minutes as h:mm', () => {
    expect(formatDuration(510)).toBe('8:30');
  });

  test('pads minutes below ten', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  test('renders zero minutes', () => {
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('Cairo formatters', () => {
  // Cairo is UTC+3 (EEST) on this date; 23:30 UTC rolls into the next Cairo day.
  const lateUtcEvening = new Date('2026-07-16T23:30:00Z');

  test('date uses the Cairo calendar day, not UTC', () => {
    expect(formatCairoDate(lateUtcEvening)).toContain('17');
  });

  test('time renders with Western digits', () => {
    expect(formatCairoTime(lateUtcEvening)).toMatch(/2:30/);
  });
});

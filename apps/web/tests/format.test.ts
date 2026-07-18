import { describe, expect, test } from 'vitest';

import {
  createDisplayFormatters,
  formatDuration,
} from '../src/lib/utils/format';

const formatters = createDisplayFormatters({
  locale: 'ar-EG-u-nu-latn',
  timeZone: 'Africa/Cairo',
});

describe('formatMoney', () => {
  test('renders EGP with two decimals and Western digits', () => {
    expect(formatters.formatMoney(1234.5)).toBe('1,234.50 ج.م');
  });

  test('accepts decimal strings from the API', () => {
    expect(formatters.formatMoney('99.999')).toBe('100.00 ج.م');
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

describe('backend-configured display formatters', () => {
  // Cairo is UTC+3 (EEST) on this date; 23:30 UTC rolls into the next Cairo day.
  const lateUtcEvening = new Date('2026-07-16T23:30:00Z');

  test('date uses the Cairo calendar day, not UTC', () => {
    expect(formatters.formatDate(lateUtcEvening)).toContain('17');
  });

  test('time renders with Western digits', () => {
    expect(formatters.formatTime(lateUtcEvening)).toMatch(/(?:^|\D)0?2:30(?:\D|$)/);
  });

  test('uses the supplied time zone rather than a frontend constant', () => {
    const utc = createDisplayFormatters({ locale: 'en-US', timeZone: 'UTC' });
    expect(utc.formatDateTime(lateUtcEvening)).toContain('Jul 16, 2026');
  });
});

import { describe, expect, test } from 'vitest';

import { createFormatters, formatDuration, formatters } from '../../src/lib/format';

describe('formatters (Cairo, Arabic)', () => {
  test('money: two decimals, grouped, with or without the currency', () => {
    expect(formatters.money('1234.5')).toBe('1,234.50 ج.م');
    expect(formatters.money(0)).toBe('0.00 ج.م');
    expect(formatters.money('-20', { currency: false })).toBe('-20.00');
  });

  test('date-times are shown in Cairo time, never raw ISO', () => {
    // 2026-10-14T22:30Z is already the 15th in Cairo (UTC+3 in summer time).
    const shown = formatters.dateTime('2026-10-14T22:30:00Z');
    expect(shown).not.toContain('T22');
    expect(shown).toContain('١٥');
    expect(formatters.time('2026-10-14T22:30:00Z')).toContain('١:٣٠');
  });

  test('a calendar date (YYYY-MM-DD) never shifts a day', () => {
    expect(formatters.dateOnly('2026-10-01').replace(/‏/g, '')).toBe('٠١/١٠/٢٠٢٦');
  });

  test('today in Cairo as YYYY-MM-DD', () => {
    expect(formatters.cairoToday(new Date('2026-10-14T22:30:00Z'))).toBe('2026-10-15');
  });

  test('settings from the backend override locale and zone', () => {
    const utc = createFormatters({ locale: 'en-GB', timeZone: 'UTC' });
    expect(utc.time('2026-10-14T22:30:00Z')).toBe('22:30');
  });

  test('duration as h:mm', () => {
    expect(formatDuration(510)).toBe('8:30');
    expect(formatDuration(5)).toBe('0:05');
  });
});

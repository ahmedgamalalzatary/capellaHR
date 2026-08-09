import { describe, expect, it } from 'vitest';

import { cairoMonth, nextMonth, startOfCairoDate } from './cairo-calendar.js';

describe('ERP Cairo calendar helpers', () => {
  it('uses Cairo calendar boundaries across month and daylight-saving changes', () => {
    expect(cairoMonth(new Date('2026-07-31T21:30:00.000Z'))).toBe('2026-08');
    expect(startOfCairoDate('2026-01-01').toISOString()).toBe('2025-12-31T22:00:00.000Z');
    expect(startOfCairoDate('2026-08-01').toISOString()).toBe('2026-07-31T21:00:00.000Z');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});

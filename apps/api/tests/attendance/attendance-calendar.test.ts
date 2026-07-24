import { describe, expect, it } from 'vitest';

import {
  endOfDate,
  nextCalendarDate,
  startOfDate,
} from '../../src/modules/attendance/attendance-calendar.js';

const timeZone = 'Africa/Cairo';

describe('attendance calendar boundaries', () => {
  it('resolves the first instant of a summer date at the UTC+3 offset', () => {
    expect(startOfDate('2026-07-20', timeZone).toISOString()).toBe('2026-07-19T21:00:00.000Z');
  });

  it('resolves the first instant of a winter date at the UTC+2 offset', () => {
    expect(startOfDate('2026-01-15', timeZone).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });

  it('starts a spring-forward date at 01:00 local when midnight never occurs', () => {
    expect(startOfDate('2026-04-24', timeZone).toISOString()).toBe('2026-04-23T22:00:00.000Z');
  });

  it('ends a date one millisecond before the next date begins', () => {
    expect(endOfDate('2026-07-20', timeZone).toISOString()).toBe('2026-07-20T20:59:59.999Z');
    expect(endOfDate('2026-07-20', timeZone).getTime())
      .toBe(startOfDate('2026-07-21', timeZone).getTime() - 1);
  });

  it('ends the day before a spring-forward date without overlapping it', () => {
    expect(endOfDate('2026-04-23', timeZone).getTime())
      .toBe(startOfDate('2026-04-24', timeZone).getTime() - 1);
  });

  it('advances calendar dates across month and leap-year boundaries', () => {
    expect(nextCalendarDate('2026-07-20')).toBe('2026-07-21');
    expect(nextCalendarDate('2026-07-31')).toBe('2026-08-01');
    expect(nextCalendarDate('2026-12-31')).toBe('2027-01-01');
    expect(nextCalendarDate('2028-02-28')).toBe('2028-02-29');
  });
});

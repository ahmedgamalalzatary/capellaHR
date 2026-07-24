import { describe, expect, it } from 'vitest';

import {
  listWeeklyDayRecordsQuerySchema,
  weeklyDayRecordParamsSchema,
} from './index.js';

describe('weekly day-off contracts', () => {
  it('parses record ids and list filters', () => {
    expect(weeklyDayRecordParamsSchema.parse({ recordId: '7' })).toEqual({ recordId: 7 });
    expect(listWeeklyDayRecordsQuerySchema.parse({
      search: '  أحمد  ',
      employeeId: '7',
      branchId: '3',
      status: 'weekly_day_off',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: '2',
      pageSize: '25',
    })).toEqual({
      search: 'أحمد',
      employeeId: 7,
      branchId: 3,
      status: 'weekly_day_off',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 25,
    });
  });

  it('reads the without-permission filter from query strings without truthy coercion', () => {
    const parse = (withoutPermission: unknown) => listWeeklyDayRecordsQuerySchema
      .safeParse({ withoutPermission });

    expect(parse('true').data?.withoutPermission).toBe(true);
    expect(parse('false').data?.withoutPermission).toBe(false);
    // An absent filter must stay absent rather than collapsing into `false`,
    // which would silently hide every marked absence from the register.
    expect(parse(undefined).data?.withoutPermission).toBeUndefined();
    expect(parse('yes').success).toBe(false);
    expect(parse('1').success).toBe(false);
  });

  it('rejects impossible dates, inverted ranges, and boolean numeric values', () => {
    expect(listWeeklyDayRecordsQuerySchema.safeParse({ dateFrom: '2026-02-30' }).success).toBe(false);
    expect(listWeeklyDayRecordsQuerySchema.safeParse({
      dateFrom: '2026-07-31', dateTo: '2026-07-01',
    }).success).toBe(false);
    expect(listWeeklyDayRecordsQuerySchema.safeParse({ employeeId: true }).success).toBe(false);
    expect(weeklyDayRecordParamsSchema.safeParse({ recordId: 0 }).success).toBe(false);
  });
});

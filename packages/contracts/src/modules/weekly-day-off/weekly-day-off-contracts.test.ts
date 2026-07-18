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

  it('rejects impossible dates, inverted ranges, and boolean numeric values', () => {
    expect(listWeeklyDayRecordsQuerySchema.safeParse({ dateFrom: '2026-02-30' }).success).toBe(false);
    expect(listWeeklyDayRecordsQuerySchema.safeParse({
      dateFrom: '2026-07-31', dateTo: '2026-07-01',
    }).success).toBe(false);
    expect(listWeeklyDayRecordsQuerySchema.safeParse({ employeeId: true }).success).toBe(false);
    expect(weeklyDayRecordParamsSchema.safeParse({ recordId: 0 }).success).toBe(false);
  });
});

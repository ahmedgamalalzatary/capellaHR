import { describe, expect, it } from 'vitest';

import {
  selfServiceAttendanceListQuerySchema,
  selfServiceFinancialListQuerySchema,
  selfServicePayrollMonthParamsSchema,
  selfServiceWeeklyDayListQuerySchema,
} from './index.js';

describe('employee self-service contracts', () => {
  it('accepts only own attendance history filters', () => {
    expect(selfServiceAttendanceListQuerySchema.parse({
      state: 'closed',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: '2',
    })).toEqual({
      state: 'closed',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 20,
    });
    expect(selfServiceAttendanceListQuerySchema.safeParse({ employeeId: '9' }).success).toBe(false);
    expect(selfServiceAttendanceListQuerySchema.safeParse({ branchId: '2' }).success).toBe(false);
    expect(selfServiceAttendanceListQuerySchema.safeParse({ search: 'someone else' }).success).toBe(false);
    expect(selfServiceAttendanceListQuerySchema.safeParse({
      dateFrom: '2026-07-31', dateTo: '2026-07-01',
    }).success).toBe(false);
  });

  it('accepts only paging and month filters for financial history', () => {
    expect(selfServiceFinancialListQuerySchema.parse({
      payrollMonth: '2026-07',
      page: '2',
      pageSize: '25',
    })).toEqual({ payrollMonth: '2026-07', page: 2, pageSize: 25 });

    expect(selfServiceFinancialListQuerySchema.safeParse({ employeeId: '9' }).success).toBe(false);
    expect(selfServiceFinancialListQuerySchema.safeParse({ branchId: '2' }).success).toBe(false);
    expect(selfServiceFinancialListQuerySchema.safeParse({ search: 'someone else' }).success).toBe(false);
  });

  it('accepts only own weekly-day history filters', () => {
    expect(selfServiceWeeklyDayListQuerySchema.parse({
      status: 'weekly_day_off',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    })).toEqual({
      status: 'weekly_day_off',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 1,
      pageSize: 20,
    });

    expect(selfServiceWeeklyDayListQuerySchema.safeParse({ employeeId: '9' }).success).toBe(false);
    expect(selfServiceWeeklyDayListQuerySchema.safeParse({ recordId: '1' }).success).toBe(false);
  });

  it('validates a payroll month without accepting an employee identifier', () => {
    expect(selfServicePayrollMonthParamsSchema.parse({ month: '2026-07' })).toEqual({ month: '2026-07' });
    expect(selfServicePayrollMonthParamsSchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(selfServicePayrollMonthParamsSchema.safeParse({ month: '2026-07', employeeId: '9' }).success).toBe(false);
  });
});

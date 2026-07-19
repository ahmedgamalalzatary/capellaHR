import { describe, expect, it } from 'vitest';

import {
  createReportExportSchema,
  listReportExportsQuerySchema,
  reportQuerySchema,
  reportTypeSchema,
} from './index.js';

describe('report contracts', () => {
  it('defines only the locked business report tabs', () => {
    expect(reportTypeSchema.options).toEqual([
      'branches',
      'employees',
      'devices',
      'shifts',
      'weekly-day-off',
      'attendance',
      'payroll',
      'bonuses',
      'deductions',
      'advances',
    ]);
  });

  it('parses filtered selected-record queries and preserves Western date values', () => {
    expect(reportQuerySchema.parse({
      search: '  موظف  ',
      branchId: '7',
      selection: 'selected',
      selectedIds: '3,1,3',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      monthFrom: '2026-01',
      monthTo: '2026-12',
      page: '2',
      pageSize: '50',
    })).toEqual({
      search: 'موظف',
      branchId: 7,
      selection: 'selected',
      selectedIds: [3, 1],
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      monthFrom: '2026-01',
      monthTo: '2026-12',
      page: 2,
      pageSize: 50,
    });
  });

  it('requires IDs for selected mode and rejects reversed ranges', () => {
    expect(reportQuerySchema.safeParse({ selection: 'selected' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ dateFrom: '2026-02-01', dateTo: '2026-01-31' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ monthFrom: '2026-12', monthTo: '2026-01' }).success).toBe(false);
  });

  it('creates immutable export requests without pagination controls', () => {
    expect(createReportExportSchema.parse({
      reportType: 'employees',
      filters: { branchId: 2, search: 'أحمد' },
      selection: { mode: 'selected', ids: [9, 4, 9] },
    })).toEqual({
      reportType: 'employees',
      filters: { branchId: 2, search: 'أحمد' },
      selection: { mode: 'selected', ids: [9, 4] },
    });
    expect(createReportExportSchema.safeParse({
      reportType: 'employees',
      filters: { page: 2 },
      selection: { mode: 'all' },
    }).success).toBe(false);
  });

  it('parses export-history filters and pagination', () => {
    expect(listReportExportsQuerySchema.parse({
      reportType: 'branches', status: 'completed', page: '3', pageSize: '25',
    })).toEqual({ reportType: 'branches', status: 'completed', page: 3, pageSize: 25 });
  });

  it('rejects filters that the selected report tab cannot apply', () => {
    expect(createReportExportSchema.safeParse({
      reportType: 'bonuses',
      filters: { deviceStatus: 'active' },
      selection: { mode: 'all' },
    }).success).toBe(false);
    expect(createReportExportSchema.safeParse({
      reportType: 'branches',
      filters: { monthFrom: '2026-01' },
      selection: { mode: 'all' },
    }).success).toBe(false);
  });
});

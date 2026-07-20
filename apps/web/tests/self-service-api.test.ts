import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getSelfServiceOverview,
  getSelfServicePayrollMonth,
  listSelfServiceAdvances,
  listSelfServiceBonuses,
  listSelfServiceDeductions,
  listSelfServiceWeeklyDays,
} from '../src/features/employee-self-service/api/self-service-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

describe('self-service API', () => {
  it('uses only identity-free own-record routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { profile: {} } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { payrollMonth: '2026-07' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }));
    vi.stubGlobal('fetch', fetchMock);

    await getSelfServiceOverview();
    await listSelfServiceWeeklyDays({ status: 'weekly_day_off', page: 2 });
    await getSelfServicePayrollMonth('2026-07');
    await listSelfServiceBonuses({ payrollMonth: '2026-07' });
    await listSelfServiceDeductions({ page: 2 });
    await listSelfServiceAdvances({ payrollMonth: '2026-07', page: 3 });

    const paths = fetchMock.mock.calls.map(([url]) => String(url));
    expect(paths).toEqual([
      'http://localhost:4000/api/v1/self-service/overview',
      'http://localhost:4000/api/v1/self-service/weekly-days?status=weekly_day_off&page=2',
      'http://localhost:4000/api/v1/self-service/payroll/2026-07',
      'http://localhost:4000/api/v1/self-service/bonuses?payrollMonth=2026-07',
      'http://localhost:4000/api/v1/self-service/deductions?page=2',
      'http://localhost:4000/api/v1/self-service/advances?payrollMonth=2026-07&page=3',
    ]);
    expect(paths.join(' ')).not.toMatch(/employeeId|branchId|reports|exports/);
  });
});

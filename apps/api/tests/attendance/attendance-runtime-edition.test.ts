import type { createDatabase } from '@capella/database';
import { describe, expect, it } from 'vitest';

import { createAttendanceJobsRuntime } from '../../src/modules/attendance/attendance-runtime.js';

describe('Attendance worker edition composition', () => {
  it('excludes pre-launch payroll months in the worker', async () => {
    const runtime = createAttendanceJobsRuntime(
      {} as ReturnType<typeof createDatabase>,
      { timeZone: 'Africa/Cairo', payrollEnabled: true, payrollStartMonth: '2026-09' },
    );
    await expect(runtime.payroll!.service.list({ month: '2026-08', page: 1, pageSize: 20 }))
      .resolves.toEqual({ items: [], total: 0 });
  });
  it('omits Payroll for the ERP edition', () => {
    const runtime = createAttendanceJobsRuntime(
      {} as ReturnType<typeof createDatabase>,
      { timeZone: 'Africa/Cairo', payrollEnabled: false },
    );

    expect(runtime.payroll).toBeUndefined();
    expect(runtime.repository).toBeDefined();
    expect(runtime.processor).toBeDefined();
  });

  it('retains Payroll financial locking for HR and full editions', () => {
    const runtime = createAttendanceJobsRuntime(
      {} as ReturnType<typeof createDatabase>,
      { timeZone: 'Africa/Cairo', payrollEnabled: true },
    );

    expect(runtime.payroll).toBeDefined();
  });
});

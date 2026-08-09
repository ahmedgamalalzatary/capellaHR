import { resolveEdition } from '@capella/config/edition';
import type { createDatabase } from '@capella/database';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiRuntime } from '../../src/runtime/api-runtime.js';
import { createApp } from '../../src/app.js';

const runtimeFor = (edition: string | undefined) => createApiRuntime({
  database: {} as ReturnType<typeof createDatabase>,
  edition: resolveEdition(edition),
  logger: pino({ level: 'silent' }),
  timeZone: 'Africa/Cairo',
  maxEmployeeImageBytes: 16_777_216,
});

describe('API edition runtime', () => {
  it('constructs only the core services when EDITION is missing', () => {
    const runtime = runtimeFor(undefined);

    expect(runtime.dependencies).toMatchObject({
      authService: expect.any(Object),
      branchService: expect.any(Object),
      employeeService: expect.any(Object),
      auditService: expect.any(Object),
      employeeAuthenticationEnabled: false,
    });
    expect(runtime.dependencies).not.toHaveProperty('cashierAccountsService');
    expect(runtime.dependencies).not.toHaveProperty('attendanceService');
    expect(runtime.dependencies).not.toHaveProperty('payrollService');
    expect(runtime.dependencies).not.toHaveProperty('erpSaleService');
  });

  it('constructs ERP plus live Attendance without Payroll or HR-only services', () => {
    const runtime = runtimeFor('erp');

    expect(runtime.dependencies).toMatchObject({
      cashierAccountsService: expect.any(Object),
      deviceService: expect.any(Object),
      shiftService: expect.any(Object),
      attendanceService: expect.any(Object),
      reportService: expect.any(Object),
      cashierSessionService: expect.any(Object),
      erpSaleService: expect.any(Object),
      erpAssignmentService: expect.any(Object),
      erpCommissionService: expect.any(Object),
      employeeAuthenticationEnabled: false,
    });
    expect(runtime.dependencies).not.toHaveProperty('payrollService');
    expect(runtime.dependencies).not.toHaveProperty('bonusService');
    expect(runtime.dependencies).not.toHaveProperty('selfServiceService');
    expect(runtime.dependencies).not.toHaveProperty('dashboardService');
  });

  it('constructs HR services without ERP routes or Cashier account management', () => {
    const runtime = runtimeFor('hr');

    expect(runtime.dependencies).toMatchObject({
      attendanceService: expect.any(Object),
      payrollService: expect.any(Object),
      bonusService: expect.any(Object),
      deductionService: expect.any(Object),
      advanceService: expect.any(Object),
      reportService: expect.any(Object),
      selfServiceService: expect.any(Object),
      dashboardService: expect.any(Object),
      employeeAuthenticationEnabled: true,
    });
    expect(runtime.dependencies).not.toHaveProperty('cashierAccountsService');
    expect(runtime.dependencies).not.toHaveProperty('erpSaleService');
    expect(runtime.dependencies).not.toHaveProperty('erpCommissionService');
  });

  it('constructs the union for the full edition', () => {
    const runtime = runtimeFor('full');

    expect(runtime.dependencies).toMatchObject({
      payrollService: expect.any(Object),
      selfServiceService: expect.any(Object),
      cashierAccountsService: expect.any(Object),
      erpSaleService: expect.any(Object),
      erpCommissionService: expect.any(Object),
    });
  });

  it('returns not found for routes disabled by each edition', async () => {
    const [coreAttendance, hrSales, erpPayroll] = await Promise.all([
      request(createApp(runtimeFor(undefined).dependencies)).get('/api/v1/attendance/sessions'),
      request(createApp(runtimeFor('hr').dependencies)).get('/api/v1/erp/sales'),
      request(createApp(runtimeFor('erp').dependencies)).get('/api/v1/payroll'),
    ]);

    expect(coreAttendance.status).toBe(404);
    expect(hrSales.status).toBe(404);
    expect(erpPayroll.status).toBe(404);
  });

  it.each([undefined, 'hr', 'erp', 'full'])(
    'boots the %s edition application with a live health route',
    async (edition) => {
      const response = await request(createApp(runtimeFor(edition).dependencies))
        .get('/api/v1/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    },
  );
});

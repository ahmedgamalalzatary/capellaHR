/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import type { BranchService } from '../../src/modules/branches/index.js';
import type { EmployeeService } from '../../src/modules/employees/index.js';
import { PayrollError } from '../../src/modules/payroll/index.js';
import type { ReportService } from '../../src/modules/reports/index.js';
import { createSelfServiceRouter, type SelfServiceService } from '../../src/modules/self-service/index.js';

const makeAuth = (actorType: 'admin' | 'employee' | null) => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    actorType,
    employeeId: actorType === 'employee' ? 7 : null,
  }),
}) as unknown as AuthService;

const makeService = (): SelfServiceService => ({
  getOverview: vi.fn(async () => ({
    profile: {
      employeeCode: 42, fullName: 'موظف', personalPhone: '01012345678',
      whatsappPhone: '01112345678', age: 30, address: 'القاهرة',
    },
    branch: { name: 'الرئيسي', location: 'القاهرة' },
    shift: { durationMinutes: 480 },
    baseSalary: { amount: '5000.00', currency: 'EGP' as const },
  })),
  listAttendance: vi.fn(async () => ({ items: [], total: 0 })),
  listWeeklyDays: vi.fn(async () => ({ items: [], total: 0 })),
  getPayrollMonth: vi.fn(async () => ({ payrollMonth: '2026-06' } as never)),
  listBonuses: vi.fn(async () => ({ items: [{ id: 1, payrollMonth: '2026-06', amount: '100.00', createdAt: new Date(), updatedAt: new Date() }], total: 1 })),
  listDeductions: vi.fn(async () => ({ items: [], total: 0 })),
  listAdvances: vi.fn(async () => ({ items: [], total: 0 })),
});

describe('employee self-service router', () => {
  it('forwards unexpected failures from every async handler to Express error middleware', async () => {
    const failure = new Error('database unavailable');
    const service = makeService();
    for (const method of [
      service.getOverview,
      service.listAttendance,
      service.listWeeklyDays,
      service.getPayrollMonth,
      service.listBonuses,
      service.listDeductions,
      service.listAdvances,
    ]) {
      vi.mocked(method).mockRejectedValue(failure);
    }

    const response = { locals: { actor: { type: 'employee', employeeId: 7 } } };
    const cases = [
      { path: '/overview', request: {} },
      { path: '/attendance', request: { query: {} } },
      { path: '/weekly-days', request: { query: {} } },
      { path: '/payroll/:month', request: { params: { month: '2026-07' } } },
      { path: '/bonuses', request: { query: {} } },
      { path: '/deductions', request: { query: {} } },
      { path: '/advances', request: { query: {} } },
    ];

    const router = createSelfServiceRouter(service, makeAuth('employee')) as unknown as {
      stack: Array<{
        route?: {
          path?: string;
          stack: Array<{
            handle: (request: unknown, response: unknown, next: (error?: unknown) => void) => Promise<void>;
          }>;
        };
      }>;
    };

    for (const testCase of cases) {
      const route = router.stack.find((layer) => layer.route?.path === testCase.path)?.route;
      const handler = route?.stack.at(-1)?.handle;
      const next = vi.fn();
      expect(handler, `missing route handler for ${testCase.path}`).toBeDefined();

      await expect(handler!(testCase.request, response, next)).resolves.toBeUndefined();
      expect(next).toHaveBeenCalledWith(failure);
    }
  });

  it('requires an employee session and rejects the admin actor', async () => {
    const anonymous = createApp({ authService: makeAuth(null), selfServiceService: makeService() });
    const admin = createApp({ authService: makeAuth('admin'), selfServiceService: makeService() });

    expect((await request(anonymous).get('/api/v1/self-service/overview')).status).toBe(401);
    expect((await request(admin).get('/api/v1/self-service/overview').set('Cookie', 'capella_session=x')).status).toBe(403);
  });

  it('derives the profile identity only from the employee session', async () => {
    const service = makeService();
    const response = await request(createApp({ authService: makeAuth('employee'), selfServiceService: service }))
      .get('/api/v1/self-service/overview')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(200);
    expect(service.getOverview).toHaveBeenCalledWith(7);
    expect(response.body.data.profile.employeeCode).toBe(42);
  });

  it('rejects horizontal-access filters instead of ignoring them', async () => {
    const service = makeService();
    const response = await request(createApp({ authService: makeAuth('employee'), selfServiceService: service }))
      .get('/api/v1/self-service/bonuses?employeeId=9')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(service.listBonuses).not.toHaveBeenCalled();
  });

  it('returns paginated own-record lists', async () => {
    const service = makeService();
    const response = await request(createApp({ authService: makeAuth('employee'), selfServiceService: service }))
      .get('/api/v1/self-service/bonuses?payrollMonth=2026-06&page=2&pageSize=10')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(200);
    expect(service.listBonuses).toHaveBeenCalledWith(7, { payrollMonth: '2026-06', page: 2, pageSize: 10 });
    expect(response.body.meta).toEqual({ page: 2, pageSize: 10, total: 1, totalPages: 1 });
  });

  it('derives Attendance history identity from the session and rejects horizontal filters', async () => {
    const service = makeService();
    const app = createApp({ authService: makeAuth('employee'), selfServiceService: service });
    const cookie = { Cookie: 'capella_session=x' };
    const response = await request(app)
      .get('/api/v1/self-service/attendance?state=closed&dateFrom=2026-07-01&page=2&pageSize=10')
      .set(cookie);

    expect(response.status).toBe(200);
    expect(service.listAttendance).toHaveBeenCalledWith(7, {
      state: 'closed', dateFrom: '2026-07-01', page: 2, pageSize: 10,
    });
    expect((await request(app).get('/api/v1/self-service/attendance?employeeId=9').set(cookie)).status).toBe(400);
  });

  it('has no mutation surface', async () => {
    const app = createApp({ authService: makeAuth('employee'), selfServiceService: makeService() });
    const cookie = { Cookie: 'capella_session=x' };

    expect((await request(app).post('/api/v1/self-service/bonuses').set(cookie).send({ amount: '1.00' })).status).toBe(404);
    expect((await request(app).patch('/api/v1/self-service/overview').set(cookie).send({ fullName: 'غير مسموح' })).status).toBe(404);
    expect((await request(app).delete('/api/v1/self-service/advances/1').set(cookie)).status).toBe(404);
  });

  it('cannot cross into employee images, admin mutations, Reports, or PDF exports', async () => {
    const app = createApp({
      authService: makeAuth('employee'),
      employeeService: {} as EmployeeService,
      employeeUploadMaxBytes: 16_777_216,
      branchService: {} as BranchService,
      reportService: {} as ReportService,
      selfServiceService: makeService(),
    });
    const cookie = { Cookie: 'capella_session=x' };

    for (const response of await Promise.all([
      request(app).get('/api/v1/employees/7/images/personal').set(cookie),
      request(app).patch('/api/v1/branches/1').set(cookie).send({ name: 'غير مسموح' }),
      request(app).get('/api/v1/reports/employees').set(cookie),
      request(app).post('/api/v1/reports/exports').set(cookie).send({ reportType: 'employees' }),
    ])) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('keeps open payroll fail-closed until Attendance supplies trustworthy facts', async () => {
    const service = makeService();
    vi.mocked(service.getPayrollMonth).mockRejectedValue(new PayrollError(
      'PAYROLL_ATTENDANCE_UNAVAILABLE',
      'تعذر التحقق من بيانات الحضور للراتب',
    ));

    const response = await request(createApp({ authService: makeAuth('employee'), selfServiceService: service }))
      .get('/api/v1/self-service/payroll/2026-07')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PAYROLL_ATTENDANCE_UNAVAILABLE');
  });
});

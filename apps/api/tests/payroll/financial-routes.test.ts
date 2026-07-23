/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AdvanceService } from '../../src/modules/advances/index.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import type { BonusService } from '../../src/modules/bonuses/index.js';
import type { DeductionService } from '../../src/modules/deductions/index.js';
import { PayrollError, type PayrollService } from '../../src/modules/payroll/index.js';

const makeAuth = (actorType: 'admin' | 'employee' | null = 'admin') => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    actorType, employeeId: actorType === 'employee' ? 7 : null,
  }),
}) as unknown as AuthService;
const adjustment = {
  reason: 'أداء استثنائي',
  id: 1, employeeId: 7, employeeCode: 10, employeeName: 'موظف', branchId: 2,
  branchName: 'فرع', payrollMonth: '2026-07', amount: '100.00', employeeDeletedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const bonusService = (): BonusService => ({
  create: vi.fn(async () => adjustment), get: vi.fn(async () => adjustment),
  list: vi.fn(async () => ({ items: [adjustment], total: 1 })),
  update: vi.fn(async () => adjustment), remove: vi.fn(async () => undefined),
});
const deductionService = (): DeductionService => bonusService();
const advance = {
  id: 1, employeeId: 7, employeeCode: 10, employeeName: 'موظف', branchId: 2,
  branchName: 'فرع', amount: '100.00', installmentCount: 1, startMonth: '2026-07',
  employeeDeletedAt: null, installments: [{ id: 1, ordinal: 1, payrollMonth: '2026-07', amount: '100.00' }],
  createdAt: new Date(), updatedAt: new Date(),
};
const advanceService = (): AdvanceService => ({
  create: vi.fn(async () => advance), get: vi.fn(async () => advance),
  list: vi.fn(async () => ({ items: [advance], total: 1 })),
  update: vi.fn(async () => advance), remove: vi.fn(async () => undefined),
  accelerateForDeletion: vi.fn(async () => undefined),
});
const salary = { employeeId: 7, employeeCode: 10, employeeName: 'موظف', branchId: 2, branchName: 'فرع', amount: '5000.00', deletedAt: null };
const payrollService = (): PayrollService => ({
  getBaseSalary: vi.fn(async () => salary), updateBaseSalary: vi.fn(async () => salary),
  list: vi.fn(async () => ({ items: [], total: 0 })), preview: vi.fn(async () => ({} as never)),
  finalize: vi.fn(async () => ({} as never)), finalizeBranch: vi.fn(async () => []),
  isFinanciallyLocked: vi.fn(async () => false),
});

describe('financial HTTP APIs', () => {
  it('requires an authenticated admin for all financial modules', async () => {
    const app = createApp({ authService: makeAuth('employee'), bonusService: bonusService() });
    expect((await request(app).get('/api/v1/bonuses').set('Cookie', 'capella_session=x')).status).toBe(403);
    const anonymous = createApp({ authService: makeAuth(null), payrollService: payrollService() });
    expect((await request(anonymous).get('/api/v1/payroll?month=2026-07')).status).toBe(401);
  });

  it('exposes strict CRUD for bonuses, deductions, and advances', async () => {
    const app = createApp({
      authService: makeAuth(), bonusService: bonusService(), deductionService: deductionService(),
      advanceService: advanceService(),
    });
    const cookie = { Cookie: 'capella_session=x' };
    const createdBonus = await request(app).post('/api/v1/bonuses').set(cookie)
      .send({ employeeId: 7, amount: '100', payrollMonth: '2026-07', reason: 'أداء استثنائي' });
    expect(createdBonus.status).toBe(201);
    expect(createdBonus.body.data.reason).toBe('أداء استثنائي');
    expect((await request(app).post('/api/v1/bonuses').set(cookie)
      .send({ employeeId: 7, amount: '100', payrollMonth: '2026-07' })).status).toBe(400);
    expect((await request(app).post('/api/v1/deductions').set(cookie)
      .send({ employeeId: 7, amount: '10', payrollMonth: '2026-07' })).status).toBe(201);
    expect((await request(app).post('/api/v1/advances').set(cookie)
      .send({ employeeId: 7, amount: '100', installmentCount: 1, startMonth: '2026-07' })).status).toBe(201);
    expect((await request(app).delete('/api/v1/bonuses/1').set(cookie)).status).toBe(204);
    expect((await request(app).patch('/api/v1/advances/1').set(cookie).send({ employeeId: 8 })).status).toBe(400);
  });

  it('returns pagination metadata for adjustment lists', async () => {
    const response = await request(createApp({ authService: makeAuth(), bonusService: bonusService() }))
      .get('/api/v1/bonuses?payrollMonth=2026-07&page=2&pageSize=25')
      .set('Cookie', 'capella_session=x');
    expect(response.body.meta).toEqual({ page: 2, pageSize: 25, total: 1, totalPages: 1 });
  });

  it('serves base salary and maps the unavailable Attendance boundary to 503', async () => {
    const service = payrollService();
    vi.mocked(service.preview).mockRejectedValue(new PayrollError(
      'PAYROLL_ATTENDANCE_UNAVAILABLE', 'تعذر التحقق من بيانات الحضور للراتب',
    ));
    const app = createApp({ authService: makeAuth(), payrollService: service });
    const cookie = { Cookie: 'capella_session=x' };
    expect((await request(app).get('/api/v1/payroll/employees/7/base-salary').set(cookie)).status).toBe(200);
    expect((await request(app).patch('/api/v1/payroll/employees/7/base-salary').set(cookie)
      .send({ amount: '6000' })).status).toBe(200);
    const unavailable = await request(app).get('/api/v1/payroll/employees/7/months/2026-06').set(cookie);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('PAYROLL_ATTENDANCE_UNAVAILABLE');
    expect(unavailable.body.error.message).toBe('تعذر التحقق من بيانات الحضور للراتب');
  });
});

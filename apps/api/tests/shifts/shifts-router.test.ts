/* eslint-disable @typescript-eslint/unbound-method */
import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import {
  ShiftError,
  type ShiftAssignmentRecord,
  type ShiftService,
} from '../../src/modules/shifts/index.js';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const assignment: ShiftAssignmentRecord = {
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'موظف تجريبي',
  branchId: 3,
  branchName: 'فرع القاهرة',
  durationMinutes: 600,
};

const makeAuth = (actorType: 'admin' | 'employee' | null = 'admin') => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    actorType,
    employeeId: actorType === 'employee' ? 7 : null,
  }),
}) as unknown as AuthService;

const makeService = (): ShiftService => ({
  getByEmployee: vi.fn(async () => assignment),
  list: vi.fn(async () => ({ items: [assignment], total: 1 })),
  updateByEmployee: vi.fn(async () => assignment),
  readRequiredDurationForCheckIn: vi.fn(async () => assignment.durationMinutes),
});

describe('shifts HTTP API', () => {
  it('requires an authenticated admin for every shift operation', async () => {
    const unauthenticated = createApp({ authService: makeAuth(null), shiftService: makeService() });
    const employee = createApp({ authService: makeAuth('employee'), shiftService: makeService() });

    expect((await request(unauthenticated).get('/api/v1/shifts')).status).toBe(401);
    expect((await request(employee).get('/api/v1/shifts').set('Cookie', 'capella_session=x')).status).toBe(403);
    expect((await request(employee).patch('/api/v1/shifts/employees/7')
      .set('Cookie', 'capella_session=x').send({ durationMinutes: 480 })).status).toBe(403);
  });

  it('lists assignments with parsed filters and pagination metadata', async () => {
    const service = makeService();
    const response = await request(createApp({ authService: makeAuth(), shiftService: service }))
      .get('/api/v1/shifts?search=42&branchId=3&page=2&pageSize=25')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(200);
    expect(vi.mocked(service.list)).toHaveBeenCalledWith({
      search: '42', branchId: 3, page: 2, pageSize: 25,
    });
    expect(response.body).toEqual({
      data: [expect.objectContaining({ employeeId: 7, durationMinutes: 600 })],
      meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 },
    });
  });

  it('gets and updates an assignment by employee id', async () => {
    const service = makeService();
    const app = createApp({ authService: makeAuth(), shiftService: service });

    const detail = await request(app).get('/api/v1/shifts/employees/7')
      .set('Cookie', 'capella_session=x');
    const update = await request(app).patch('/api/v1/shifts/employees/7')
      .set('Cookie', 'capella_session=x').send({ durationMinutes: 480 });

    expect(detail.status).toBe(200);
    expect(update.status).toBe(200);
    expect(vi.mocked(service.getByEmployee)).toHaveBeenCalledWith(7);
    expect(vi.mocked(service.updateByEmployee)).toHaveBeenCalledWith(7, { durationMinutes: 480 });
  });

  it('returns structured validation and missing-assignment errors', async () => {
    const service = makeService();
    const getByEmployee = vi.mocked(service.getByEmployee);
    getByEmployee.mockRejectedValue(new ShiftError(
      'SHIFT_ASSIGNMENT_NOT_FOUND',
      'تعيين الوردية غير موجود',
    ));
    const app = createApp({ authService: makeAuth(), shiftService: service });

    const invalid = await request(app).patch('/api/v1/shifts/employees/7')
      .set('Cookie', 'capella_session=x').send({ durationMinutes: 721 });
    const missing = await request(app).get('/api/v1/shifts/employees/7')
      .set('Cookie', 'capella_session=x').set('x-request-id', 'shift-test');

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({
      code: 'SHIFT_ASSIGNMENT_NOT_FOUND',
      message: 'تعيين الوردية غير موجود',
      requestId: 'shift-test',
    });
  });

  it('rejects boolean duration values instead of coercing them to minutes', async () => {
    const service = makeService();
    const response = await request(createApp({ authService: makeAuth(), shiftService: service }))
      .patch('/api/v1/shifts/employees/7')
      .set('Cookie', 'capella_session=x')
      .send({ durationMinutes: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(vi.mocked(service.updateByEmployee)).not.toHaveBeenCalled();
  });

  it('does not expose independent create or delete operations', async () => {
    const app = createApp({ authService: makeAuth(), shiftService: makeService() });

    expect((await request(app).post('/api/v1/shifts')
      .set('Cookie', 'capella_session=x').send({ durationMinutes: 600 })).status).toBe(404);
    expect((await request(app).delete('/api/v1/shifts/employees/7')
      .set('Cookie', 'capella_session=x')).status).toBe(404);
  });
});

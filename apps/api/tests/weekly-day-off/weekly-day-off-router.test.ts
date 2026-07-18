/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import {
  WeeklyDayOffError,
  type WeeklyDayOffService,
  type WeeklyDayRecord,
} from '../../src/modules/weekly-day-off/index.js';

const record: WeeklyDayRecord = {
  id: 11,
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'موظف تجريبي',
  branchId: 3,
  branchName: 'فرع القاهرة',
  attendanceDate: '2026-07-10',
  status: 'weekly_day_off',
  absenceRequiredMinutes: 600,
  requiredMinutes: 0,
  dayOffConvertedAt: new Date('2026-07-18T09:00:00.000Z'),
  createdAt: new Date('2026-07-11T00:00:00.000Z'),
  updatedAt: new Date('2026-07-18T09:00:00.000Z'),
};

const makeAuth = (actorType: 'admin' | 'employee' | null = 'admin') => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    actorType,
    employeeId: actorType === 'employee' ? 7 : null,
  }),
}) as unknown as AuthService;

const makeService = (): WeeklyDayOffService => ({
  get: vi.fn(async () => record),
  list: vi.fn(async () => ({ items: [record], total: 1 })),
  convert: vi.fn(async () => record),
  revert: vi.fn(async () => ({
    ...record,
    status: 'absence' as const,
    requiredMinutes: 600,
  })),
});

describe('weekly day-off HTTP API', () => {
  it('requires an authenticated admin for every operation', async () => {
    const unauthenticated = createApp({
      authService: makeAuth(null), weeklyDayOffService: makeService(),
    });
    const employee = createApp({
      authService: makeAuth('employee'), weeklyDayOffService: makeService(),
    });

    expect((await request(unauthenticated).get('/api/v1/weekly-day-offs')).status).toBe(401);
    expect((await request(employee).post('/api/v1/weekly-day-offs/11/convert')
      .set('Cookie', 'capella_session=x')).status).toBe(403);
  });

  it('lists filtered records with pagination metadata', async () => {
    const service = makeService();
    const response = await request(createApp({
      authService: makeAuth(), weeklyDayOffService: service,
    })).get('/api/v1/weekly-day-offs?search=42&branchId=3&status=absence&dateFrom=2026-07-01&dateTo=2026-07-31&page=2&pageSize=25')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(200);
    expect(vi.mocked(service.list)).toHaveBeenCalledWith({
      search: '42', branchId: 3, status: 'absence', dateFrom: '2026-07-01',
      dateTo: '2026-07-31', page: 2, pageSize: 25,
    });
    expect(response.body.meta).toEqual({ page: 2, pageSize: 25, total: 1, totalPages: 1 });
  });

  it('gets, converts, and reverts a record', async () => {
    const service = makeService();
    const app = createApp({ authService: makeAuth(), weeklyDayOffService: service });
    const cookie = { Cookie: 'capella_session=x' };

    expect((await request(app).get('/api/v1/weekly-day-offs/11').set(cookie)).status).toBe(200);
    expect((await request(app).post('/api/v1/weekly-day-offs/11/convert').set(cookie)).status).toBe(200);
    expect((await request(app).post('/api/v1/weekly-day-offs/11/revert').set(cookie)).status).toBe(200);
    expect(vi.mocked(service.convert)).toHaveBeenCalledWith(11);
    expect(vi.mocked(service.revert)).toHaveBeenCalledWith(11);
  });

  it('returns structured domain and validation errors', async () => {
    const service = makeService();
    vi.mocked(service.convert).mockRejectedValue(new WeeklyDayOffError(
      'WEEKLY_DAY_OFF_SPACING_CONFLICT',
      'يجب أن يفصل سبعة أيام على الأقل بين أيام الراحة',
    ));
    const app = createApp({ authService: makeAuth(), weeklyDayOffService: service });

    const conflict = await request(app).post('/api/v1/weekly-day-offs/11/convert')
      .set('Cookie', 'capella_session=x').set('x-request-id', 'day-off-test');
    const invalid = await request(app).get('/api/v1/weekly-day-offs?dateFrom=2026-02-30')
      .set('Cookie', 'capella_session=x');

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toEqual({
      code: 'WEEKLY_DAY_OFF_SPACING_CONFLICT',
      message: 'يجب أن يفصل سبعة أيام على الأقل بين أيام الراحة',
      requestId: 'day-off-test',
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not expose arbitrary create, update, or delete operations', async () => {
    const app = createApp({ authService: makeAuth(), weeklyDayOffService: makeService() });
    const cookie = { Cookie: 'capella_session=x' };

    expect((await request(app).post('/api/v1/weekly-day-offs').set(cookie).send({})).status).toBe(404);
    expect((await request(app).patch('/api/v1/weekly-day-offs/11').set(cookie).send({})).status).toBe(404);
    expect((await request(app).delete('/api/v1/weekly-day-offs/11').set(cookie)).status).toBe(404);
  });
});

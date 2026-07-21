/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AttendanceService } from '../../src/modules/attendance/index.js';
import type { AuthService } from '../../src/modules/auth/index.js';

const now = new Date('2026-07-20T09:00:00.000Z');
const session = {
  id: 11,
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'موظف تجريبي',
  branchId: 3,
  branchName: 'القاهرة',
  attendanceDate: '2026-07-20',
  requiredMinutes: 480,
  checkInAt: now,
  checkOutAt: null,
  workedMinutes: null,
  overtimeMinutes: null,
  shortageMinutes: null,
  automaticTimeoutAt: null,
  automaticTimeoutCorrectedAt: null,
  flagged: false,
  createdAt: now,
  updatedAt: now,
};
const makeAuth = (actorType: 'admin' | 'employee' | null = 'admin') => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    actorType,
    employeeId: actorType === 'employee' ? 7 : null,
  }),
}) as unknown as AuthService;
const makeService = (): AttendanceService => ({
  beginDeviceAuthentication: vi.fn(async () => ({ challengeId: 'challenge' })),
  checkIn: vi.fn(async () => session),
  checkOut: vi.fn(async () => ({ ...session, checkOutAt: now })),
  manualCheckIn: vi.fn(async () => session),
  manualCheckOut: vi.fn(async () => ({ ...session, checkOutAt: now })),
  approveDeniedAttempt: vi.fn(async () => session),
  dismissDeniedAttempt: vi.fn(async () => ({ id: 5, dismissedAt: now } as never)),
  correctAutomaticTimeout: vi.fn(async () => session),
  getSession: vi.fn(async () => session),
  listSessions: vi.fn(async () => ({ items: [session], total: 1 })),
  listDeniedAttempts: vi.fn(async () => ({ items: [], total: 0 })),
  hasOpenSession: vi.fn(async () => true),
});
const deviceProof = {
  challengeId: 'b4f3550c-0230-4a73-ae58-f4086ab13206',
  installationMarker: 'installation-marker-123',
  response: {
    id: 'credential', rawId: 'credential', type: 'public-key',
    response: {
      clientDataJSON: 'client', authenticatorData: 'authenticator', signature: 'signature',
    },
    clientExtensionResults: {},
  },
};

describe('attendance HTTP API', () => {
  it('keeps employee check-in/out public while validating every factor payload', async () => {
    const service = makeService();
    const app = createApp({ authService: makeAuth(null), attendanceService: service });
    const payload = {
      employeeCode: 42,
      pin: '1234',
      source: 'personal_device',
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      deviceProof,
    };

    expect((await request(app).post('/api/v1/attendance/check-in').send(payload)).status).toBe(201);
    expect((await request(app).post('/api/v1/attendance/check-out').send(payload)).status).toBe(200);
    expect(vi.mocked(service.checkIn)).toHaveBeenCalledWith(payload);
    expect((await request(app).post('/api/v1/attendance/check-in')
      .send({ ...payload, pin: '١٢٣٤' })).status).toBe(400);
  });

  it('provides public source-aware device authentication options', async () => {
    const service = makeService();
    const response = await request(createApp({
      authService: makeAuth(null), attendanceService: service,
    })).post('/api/v1/attendance/device-authentication/options').send({
      employeeCode: 42,
      eventType: 'check_in',
      source: 'branch_device',
      installationMarker: 'installation-marker-123',
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(service.beginDeviceAuthentication)).toHaveBeenCalledWith({
      employeeCode: 42,
      eventType: 'check_in',
      source: 'branch_device',
      installationMarker: 'installation-marker-123',
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
    });
  });

  it('requires an admin for manual, review, list, approval, and correction operations', async () => {
    const service = makeService();
    const unauthenticated = createApp({ authService: makeAuth(null), attendanceService: service });
    const employee = createApp({ authService: makeAuth('employee'), attendanceService: service });

    expect((await request(unauthenticated).get('/api/v1/attendance/sessions')).status).toBe(401);
    expect((await request(employee).post('/api/v1/attendance/manual/check-in')
      .set('Cookie', 'capella_session=x')
      .send({ employeeId: 7, occurredAt: now.toISOString() })).status).toBe(403);
  });

  it('exposes the complete admin attendance workflow with pagination', async () => {
    const service = makeService();
    const app = createApp({ authService: makeAuth(), attendanceService: service });
    const cookie = { Cookie: 'capella_session=x' };

    const listed = await request(app).get('/api/v1/attendance/sessions?page=2&pageSize=10')
      .set(cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.meta).toEqual({ page: 2, pageSize: 10, total: 1, totalPages: 1 });
    expect((await request(app).get('/api/v1/attendance/sessions/11').set(cookie)).status).toBe(200);
    expect((await request(app).get('/api/v1/attendance/denied-attempts').set(cookie)).status).toBe(200);
    expect((await request(app).post('/api/v1/attendance/manual/check-in').set(cookie)
      .send({ employeeId: 7, occurredAt: now.toISOString() })).status).toBe(201);
    expect((await request(app).post('/api/v1/attendance/manual/check-out').set(cookie)
      .send({ employeeId: 7, occurredAt: now.toISOString() })).status).toBe(200);
    expect((await request(app).post('/api/v1/attendance/denied-attempts/5/approve')
      .set(cookie)).status).toBe(200);
    expect((await request(app).post('/api/v1/attendance/denied-attempts/5/dismiss')
      .set(cookie)).status).toBe(200);
    expect((await request(app).patch('/api/v1/attendance/sessions/11/automatic-timeout')
      .set(cookie).send({ checkOutAt: now.toISOString() })).status).toBe(200);
  });

  it('forwards unexpected failures to the application error middleware', async () => {
    const service = makeService();
    vi.mocked(service.checkIn).mockRejectedValue(new Error('database unavailable'));
    const response = await request(createApp({
      authService: makeAuth(), attendanceService: service,
    })).post('/api/v1/attendance/check-in').set('x-request-id', 'attendance-error').send({
      employeeCode: 42,
      pin: '1234',
      source: 'personal_device',
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      deviceProof,
    });

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_ERROR', requestId: 'attendance-error',
    });
  });
});

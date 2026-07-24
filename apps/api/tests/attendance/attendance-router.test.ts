import request from 'supertest';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AttendanceService } from '../../src/modules/attendance/index.js';
import type { AuthService } from '../../src/modules/auth/index.js';

const now = new Date('2026-07-20T09:00:00.000Z');
const truncatedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
const validJpegFixture = () => sharp({
  create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
}).jpeg().toBuffer();
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
  hasAnyOpenSession: vi.fn(async () => true),
});

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
      installationMarker: 'installation-marker-123',
    };

    const liveImage = await validJpegFixture();
    let receivedFaceImage: Buffer | undefined;
    vi.mocked(service.checkIn).mockImplementationOnce(async (input) => {
      receivedFaceImage = Buffer.from(input.faceImage);
      return session;
    });
    const checkIn = await request(app).post('/api/v1/attendance/check-in')
      .field('payload', JSON.stringify(payload))
      .attach('faceImage', liveImage, { filename: 'face.jpg', contentType: 'image/jpeg' });
    const checkOut = await request(app).post('/api/v1/attendance/check-out')
      .field('payload', JSON.stringify(payload))
      .attach('faceImage', liveImage, { filename: 'face.jpg', contentType: 'image/jpeg' });
    expect(checkIn.status).toBe(201);
    expect(checkOut.status).toBe(200);
    expect(vi.mocked(service.checkIn)).toHaveBeenCalledWith(expect.objectContaining(payload));
    expect(receivedFaceImage).toEqual(liveImage);
    expect(vi.mocked(service.checkIn).mock.calls[0]![0].faceImage.every((byte) => byte === 0)).toBe(true);
    expect((await request(app).post('/api/v1/attendance/check-in')
      .field('payload', JSON.stringify({ ...payload, pin: '١٢٣٤' }))
      .attach('faceImage', liveImage, { filename: 'face.jpg', contentType: 'image/jpeg' })).status).toBe(400);
  });

  it('requires one real camera image without invoking attendance', async () => {
    const service = makeService();
    const app = createApp({ authService: makeAuth(null), attendanceService: service });
    const payload = JSON.stringify({ employeeCode: 42, pin: '1234', source: 'personal_device', latitude: 30, longitude: 31, gpsAccuracyMeters: 8, installationMarker: 'installation-marker-123' });
    const validImage = await validJpegFixture();
    const fill = vi.spyOn(Buffer.prototype, 'fill');

    expect((await request(app).post('/api/v1/attendance/check-in').field('payload', payload)).status).toBe(400);
    expect((await request(app).post('/api/v1/attendance/check-in').field('payload', payload)
      .attach('faceImage', Buffer.from('not an image'), { filename: 'face.jpg', contentType: 'image/jpeg' })).status).toBe(400);
    expect((await request(app).post('/api/v1/attendance/check-in').field('payload', payload)
      .attach('faceImage', truncatedJpeg, { filename: 'face.jpg', contentType: 'image/jpeg' })).status).toBe(400);
    expect(fill).toHaveBeenCalled();
    fill.mockClear();
    expect((await request(app).post('/api/v1/attendance/check-in').field('payload', '{')
      .attach('faceImage', validImage, { filename: 'face.jpg', contentType: 'image/jpeg' })).status).toBe(400);
    expect(fill).toHaveBeenCalled();
    fill.mockClear();
    expect((await request(app).post('/api/v1/attendance/check-in').field('payload', JSON.stringify({ ...JSON.parse(payload), pin: '12' }))
      .attach('faceImage', validImage, { filename: 'face.jpg', contentType: 'image/jpeg' })).status).toBe(400);
    expect(fill).toHaveBeenCalled();
    expect((await request(app).post('/api/v1/attendance/check-in').field('payload', payload)
      .attach('faceImage', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'face.jpg', contentType: 'image/jpeg' })).status).toBe(400);
    expect(service.checkIn).not.toHaveBeenCalled();
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
    const liveImage = await validJpegFixture();
    vi.mocked(service.checkIn).mockRejectedValue(new Error('database unavailable'));
    const response = await request(createApp({
      authService: makeAuth(), attendanceService: service,
    })).post('/api/v1/attendance/check-in').set('x-request-id', 'attendance-error')
      .field('payload', JSON.stringify({
      employeeCode: 42,
      pin: '1234',
      source: 'personal_device',
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      installationMarker: 'installation-marker-123',
      })).attach('faceImage', liveImage, { filename: 'face.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_ERROR', requestId: 'attendance-error',
    });
  });
});

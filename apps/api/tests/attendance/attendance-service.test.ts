/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import {
  calculateAttendanceMinutes,
  calculateDistanceMeters,
  createAttendanceService,
  type DeniedAttendanceInput,
  type AttendanceDeviceGateway,
  type AttendanceRepository,
} from '../../src/modules/attendance/attendance-service.js';

const now = new Date('2026-07-20T09:00:00.000Z');
const identity = {
  id: 7,
  employeeCode: 42,
  pinHash: 'stored-pin-hash',
  credentialVersion: 3,
  deletedAt: null,
  branchId: 2,
  branchLatitude: 30.0444,
  branchLongitude: 31.2357,
  branchRadiusMeters: 150,
  personalPhotoPath: 'employees/personal.jpg',
};
const session = {
  id: 11,
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'موظف تجريبي',
  branchId: 2,
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

const makeRepository = (): AttendanceRepository => ({
  findIdentityByCode: vi.fn(async () => identity),
  recordDeniedAttempt: vi.fn(async (attempt: DeniedAttendanceInput) => ({
    id: 5,
    ...attempt,
    approvedAt: null,
    approvedSessionId: null,
    dismissedAt: null,
    createdAt: now,
  })),
  checkIn: vi.fn(async () => ({ kind: 'success' as const, session })),
  checkOut: vi.fn(async () => ({ kind: 'success' as const, session: { ...session, checkOutAt: now } })),
  manualCheckIn: vi.fn(async () => ({ kind: 'success' as const, session })),
  manualCheckOut: vi.fn(async () => ({ kind: 'success' as const, session: { ...session, checkOutAt: now } })),
  approveDeniedAttempt: vi.fn(async () => ({ kind: 'success' as const, session })),
  dismissDeniedAttempt: vi.fn(async () => ({ kind: 'not_found' as const })),
  correctAutomaticTimeout: vi.fn(async () => ({ kind: 'success' as const, session })),
  getSession: vi.fn(async () => session),
  listSessions: vi.fn(async () => ({ items: [session], total: 1 })),
  listDeniedAttempts: vi.fn(async () => ({ items: [], total: 0 })),
  hasOpenSession: vi.fn(async () => true),
});

const installationMarker = 'installation-marker-123';
const event = {
  employeeCode: 42,
  pin: '1234',
  source: 'personal_device' as const,
  latitude: 30.0444,
  longitude: 31.2357,
  gpsAccuracyMeters: 8,
  installationMarker,
  faceImage: Buffer.from('live-face'),
};

const createService = (repository = makeRepository()) => {
  const devices: AttendanceDeviceGateway = {
    verify: vi.fn(async () => ({ id: 9, verified: true })),
  };
  const verifyPin = vi.fn(async () => true);
  const faces = {
    compare: vi.fn(async () => ({ kind: 'match' as const })),
  };
  return {
    repository,
    devices,
    verifyPin,
    faces,
    service: createAttendanceService(repository, devices, faces, {
      now: () => now,
      verifyPin,
    }),
  };
};

describe('attendance service', () => {
  it('calculates inclusive GPS distance and whole completed attendance minutes', () => {
    expect(calculateDistanceMeters(30.0444, 31.2357, 30.0444, 31.2357)).toBe(0);
    expect(calculateDistanceMeters(
      30.0444,
      31.2357,
      -30.04439999853439,
      -148.7643000021153,
    )).toBeGreaterThan(20_000_000);
    expect(calculateAttendanceMinutes(
      new Date('2026-07-20T08:00:59.999Z'),
      new Date('2026-07-20T09:01:00.000Z'),
      60,
    )).toEqual({ workedMinutes: 60, overtimeMinutes: 0, shortageMinutes: 0 });
    expect(calculateAttendanceMinutes(now, new Date(now.getTime() + 61 * 60_000), 60))
      .toEqual({ workedMinutes: 61, overtimeMinutes: 1, shortageMinutes: 0 });
  });

  it('checks in with the personal device assignment and complete GPS snapshot', async () => {
    const { service, repository, devices } = createService();

    await expect(service.checkIn(event)).resolves.toEqual(session);
    expect(devices.verify).toHaveBeenCalledWith(
      { assignmentType: 'employee', assignmentId: 7 },
      installationMarker,
    );
    expect(repository.checkIn).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 7,
      expectedCredentialVersion: 3,
      deviceId: 9,
      occurredAt: now,
      distanceMeters: 0,
      branchLatitude: 30.0444,
      branchLongitude: 31.2357,
      branchRadiusMeters: 150,
    }));
  });

  it('uses the assigned branch device for a branch-phone event', async () => {
    const { service, devices } = createService();
    await service.checkOut({ ...event, source: 'branch_device' });
    expect(devices.verify).toHaveBeenCalledWith(
      { assignmentType: 'branch', assignmentId: 2 },
      installationMarker,
    );
  });

  it('records a face mismatch and does not create attendance', async () => {
    const setup = createService();
    setup.faces.compare.mockResolvedValue({ kind: 'mismatch' });

    await expect(setup.service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_FACE_MISMATCH',
    });
    expect(setup.faces.compare).toHaveBeenCalledWith(
      'employees/personal.jpg',
      event.faceImage,
    );
    expect(setup.repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      failureReason: 'FACE_MISMATCH',
      suspicious: true,
    }));
    expect(setup.repository.checkIn).not.toHaveBeenCalled();
  });

  it('records and flags a wrong PIN without checking later factors', async () => {
    const repository = makeRepository();
    const devices = {
      verify: vi.fn(async () => ({ id: 9, verified: true })),
    };
    const service = createAttendanceService(repository, devices, { compare: vi.fn() }, {
      now: () => now,
      verifyPin: vi.fn(async () => false),
    });

    await expect(service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_INVALID_CREDENTIALS',
    });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'check_in',
      employeeId: 7,
      deviceId: null,
      failureReason: 'INVALID_CREDENTIALS',
      suspicious: true,
    }));
    expect(devices.verify).not.toHaveBeenCalled();
  });

  it('records and flags a point outside the exact assigned-branch radius', async () => {
    const { service, repository, devices } = createService();

    await expect(service.checkIn({ ...event, latitude: 31 })).rejects.toMatchObject({
      code: 'ATTENDANCE_OUT_OF_RANGE',
    });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      failureReason: 'OUT_OF_RANGE', suspicious: true,
    }));
    expect(devices.verify).toHaveBeenCalledWith(
      { assignmentType: 'employee', assignmentId: 7 },
      installationMarker,
    );
  });

  it('accepts a nonzero point exactly on the configured inclusive radius', async () => {
    const repository = makeRepository();
    const longitude = 31.236;
    const radius = calculateDistanceMeters(30.0444, longitude, 30.0444, 31.2357);
    vi.mocked(repository.findIdentityByCode).mockResolvedValue({
      ...identity,
      branchRadiusMeters: radius,
    });
    const { service } = createService(repository);

    await expect(service.checkIn({ ...event, longitude })).resolves.toEqual(session);
    expect(repository.checkIn).toHaveBeenCalledWith(expect.objectContaining({
      distanceMeters: radius,
      branchRadiusMeters: radius,
    }));
  });

  it('fails closed for a near-antipodal point whose haversine term rounds above one', async () => {
    const { service, repository, devices } = createService();

    await expect(service.checkIn({
      ...event,
      latitude: -30.04439999853439,
      longitude: -148.7643000021153,
    })).rejects.toMatchObject({ code: 'ATTENDANCE_OUT_OF_RANGE' });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      failureReason: 'OUT_OF_RANGE', suspicious: true,
    }));
    expect(devices.verify).toHaveBeenCalledOnce();
  });

  it('does not check later factors when the claimed employee credentials are invalid', async () => {
    const repository = makeRepository();
    vi.mocked(repository.findIdentityByCode).mockResolvedValue(null);
    const devices = {
      verify: vi.fn(async () => null),
    };
    const service = createAttendanceService(repository, devices, { compare: vi.fn() }, {
      now: () => now,
      verifyPin: vi.fn(async () => false),
    });

    await expect(service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_INVALID_CREDENTIALS',
    });
    expect(devices.verify).not.toHaveBeenCalled();
  });

  it('records repository state conflicts as denied attempts', async () => {
    const repository = makeRepository();
    vi.mocked(repository.checkIn).mockResolvedValue({ kind: 'open_session_exists' });
    const { service } = createService(repository);

    await expect(service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_OPEN_SESSION_EXISTS',
    });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      failureReason: 'OPEN_SESSION_EXISTS', suspicious: false,
    }));
  });

  it('retains a known candidate device id when its marker is invalidated concurrently', async () => {
    const repository = makeRepository();
    const devices = {
      verify: vi.fn(async () => ({ id: 9, verified: false })),
    };
    const service = createAttendanceService(repository, devices, { compare: vi.fn() }, {
      now: () => now,
      verifyPin: vi.fn(async () => true),
    });

    await expect(service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_DEVICE_INVALID',
    });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 9,
      failureReason: 'DEVICE_INVALID',
    }));
  });

  it('rechecks GPS against the branch snapshot locked by the transaction', async () => {
    const repository = makeRepository();
    vi.mocked(repository.checkIn).mockResolvedValue({
      kind: 'out_of_range',
      evaluation: {
        distanceMeters: 200,
        branchLatitude: 30.1,
        branchLongitude: 31.2,
        branchRadiusMeters: 50,
      },
    });
    const { service } = createService(repository);

    await expect(service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_OUT_OF_RANGE',
    });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      failureReason: 'OUT_OF_RANGE',
      suspicious: true,
      distanceMeters: 200,
      branchLatitude: 30.1,
      branchLongitude: 31.2,
      branchRadiusMeters: 50,
    }));
  });

  it('rejects future manual events before repository mutation', async () => {
    const { service, repository } = createService();
    await expect(service.manualCheckIn({
      employeeId: 7,
      occurredAt: new Date(now.getTime() + 1),
    })).rejects.toMatchObject({ code: 'ATTENDANCE_FUTURE_EVENT' });
    expect(repository.manualCheckIn).not.toHaveBeenCalled();
  });

  it.each([
    ['weekly_day_off', 'ATTENDANCE_WEEKLY_DAY_OFF'],
    ['session_exists', 'ATTENDANCE_SESSION_EXISTS'],
    ['open_session_exists', 'ATTENDANCE_OPEN_SESSION_EXISTS'],
  ] as const)('maps check-in conflict %s to %s', async (kind, code) => {
    const repository = makeRepository();
    vi.mocked(repository.manualCheckIn).mockResolvedValue({ kind });
    const { service } = createService(repository);
    await expect(service.manualCheckIn({ employeeId: 7, occurredAt: now }))
      .rejects.toMatchObject({ code });
  });

  it('maps denied approval and automatic-timeout correction state failures', async () => {
    const repository = makeRepository();
    vi.mocked(repository.approveDeniedAttempt).mockResolvedValue({ kind: 'already_approved' });
    vi.mocked(repository.correctAutomaticTimeout).mockResolvedValue({ kind: 'not_automatic_timeout' });
    const { service } = createService(repository);

    await expect(service.approveDeniedAttempt(5)).rejects.toMatchObject({
      code: 'ATTENDANCE_DENIED_ALREADY_APPROVED',
    });
    await expect(service.correctAutomaticTimeout(11, { checkOutAt: now }))
      .rejects.toMatchObject({ code: 'ATTENDANCE_AUTOMATIC_TIMEOUT_ONLY' });
  });
});

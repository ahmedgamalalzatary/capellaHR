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

const proof = {
  challengeId: 'b4f3550c-0230-4a73-ae58-f4086ab13206',
  installationMarker: 'installation-marker-123',
  response: {
    id: 'credential', rawId: 'credential', type: 'public-key' as const,
    response: {
      clientDataJSON: 'client', authenticatorData: 'authenticator', signature: 'signature',
    },
    clientExtensionResults: {},
  },
};
const event = {
  employeeCode: 42,
  pin: '1234',
  source: 'personal_device' as const,
  latitude: 30.0444,
  longitude: 31.2357,
  gpsAccuracyMeters: 8,
  deviceProof: proof,
};
const deviceOptionsInput = {
  employeeCode: 42,
  eventType: 'check_in' as const,
  source: 'personal_device' as const,
  installationMarker: 'installation-marker-123',
  latitude: 30.0444,
  longitude: 31.2357,
  gpsAccuracyMeters: 8,
};

const createService = (repository = makeRepository()) => {
  const devices: AttendanceDeviceGateway = {
    beginAuthentication: vi.fn(async () => ({ challengeId: 'challenge' })),
    verify: vi.fn(async () => ({ id: 9, verified: true })),
  };
  return {
    repository,
    devices,
    service: createAttendanceService(repository, devices, {
      now: () => now,
      verifyPin: vi.fn(async () => true),
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

  it('records an invalid-device preflight as exactly one denied attendance attempt', async () => {
    const { service, repository, devices } = createService();
    vi.mocked(devices.beginAuthentication).mockResolvedValue(null);

    await expect(service.beginDeviceAuthentication(deviceOptionsInput)).rejects.toMatchObject({
      code: 'ATTENDANCE_VERIFICATION_FAILED',
    });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledOnce();
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'check_in',
      claimedEmployeeCode: 42,
      employeeId: 7,
      source: 'personal_device',
      occurredAt: now,
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      distanceMeters: 0,
      failureReason: 'DEVICE_INVALID',
      suspicious: true,
    }));
  });

  it('records unknown-code and out-of-range preflights without issuing a challenge', async () => {
    const unknownRepository = makeRepository();
    vi.mocked(unknownRepository.findIdentityByCode).mockResolvedValue(null);
    const unknown = createService(unknownRepository);
    await expect(unknown.service.beginDeviceAuthentication(deviceOptionsInput)).rejects.toMatchObject({
      code: 'ATTENDANCE_VERIFICATION_FAILED',
    });
    expect(unknownRepository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: null,
      failureReason: 'INVALID_CREDENTIALS',
      suspicious: true,
    }));
    expect(unknown.devices.beginAuthentication).not.toHaveBeenCalled();

    const outside = createService();
    await expect(outside.service.beginDeviceAuthentication({
      ...deviceOptionsInput,
      latitude: 31,
    })).rejects.toMatchObject({ code: 'ATTENDANCE_VERIFICATION_FAILED' });
    expect(outside.repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      failureReason: 'OUT_OF_RANGE',
      suspicious: true,
    }));
    expect(outside.devices.beginAuthentication).not.toHaveBeenCalled();
  });

  it('masks every preflight factor failure behind the same external error', async () => {
    const invalidDevice = createService();
    vi.mocked(invalidDevice.devices.beginAuthentication).mockResolvedValue(null);
    await expect(invalidDevice.service.beginDeviceAuthentication(deviceOptionsInput)).rejects.toMatchObject({
      code: 'ATTENDANCE_VERIFICATION_FAILED',
      message: 'تعذر التحقق من بيانات الحضور',
    });
  });

  it('checks in with the personal device assignment and complete GPS snapshot', async () => {
    const { service, repository, devices } = createService();

    await expect(service.checkIn(event)).resolves.toEqual(session);
    expect(devices.verify).toHaveBeenCalledWith(
      { assignmentType: 'employee', assignmentId: 7 },
      proof,
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
      proof,
    );
  });

  it('records and flags a wrong PIN after consuming the supplied one-time device proof', async () => {
    const repository = makeRepository();
    const devices = {
      beginAuthentication: vi.fn(),
      verify: vi.fn(async () => ({ id: 9, verified: true })),
    };
    const service = createAttendanceService(repository, devices, {
      now: () => now,
      verifyPin: vi.fn(async () => false),
    });

    await expect(service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_INVALID_CREDENTIALS',
    });
    expect(repository.recordDeniedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'check_in',
      employeeId: 7,
      deviceId: 9,
      failureReason: 'INVALID_CREDENTIALS',
      suspicious: true,
    }));
    expect(devices.verify).toHaveBeenCalledWith(
      { assignmentType: 'employee', assignmentId: 7 },
      proof,
    );
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
      proof,
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

  it('consumes a submitted proof even when the claimed employee code is unknown', async () => {
    const repository = makeRepository();
    vi.mocked(repository.findIdentityByCode).mockResolvedValue(null);
    const devices = {
      beginAuthentication: vi.fn(),
      verify: vi.fn(async () => null),
    };
    const service = createAttendanceService(repository, devices, {
      now: () => now,
      verifyPin: vi.fn(async () => false),
    });

    await expect(service.checkIn(event)).rejects.toMatchObject({
      code: 'ATTENDANCE_INVALID_CREDENTIALS',
    });
    expect(devices.verify).toHaveBeenCalledWith(
      { assignmentType: 'employee', assignmentId: 0 },
      proof,
    );
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

  it('retains a known candidate device id when its consumed proof is invalid', async () => {
    const repository = makeRepository();
    const devices = {
      beginAuthentication: vi.fn(),
      verify: vi.fn(async () => ({ id: 9, verified: false })),
    };
    const service = createAttendanceService(repository, devices, {
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

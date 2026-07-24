import { hash } from 'argon2';
import { beforeAll, describe, expect, it } from 'vitest';

import * as auth from '../../src/modules/auth/index.js';

type Session = {
  id: string;
  tokenHash: string;
  actorType: 'admin' | 'employee';
  employeeId: number | null;
  revokedAt: Date | null;
};

class MemorySessions {
  readonly rows: Session[] = [];
  employeeCurrent = true;
  attendanceEligibilityChecks = 0;
  deviceEligibilityChecks = 0;
  readonly transactionContext = { kind: 'auth-transaction' };

  async create(session: Session) { this.rows.push(session); }
  async createEmployeeIfCurrent(
    session: Session,
    _credentialVersion?: number,
    deviceEligible?: (context: unknown) => Promise<boolean>,
    attendanceEligible?: (context: unknown) => Promise<boolean>,
  ) {
    if (!this.employeeCurrent) return 'credentials_changed' as const;
    if (deviceEligible) {
      this.deviceEligibilityChecks += 1;
      if (!await deviceEligible(this.transactionContext)) return 'device_invalid' as const;
    }
    if (attendanceEligible) {
      this.attendanceEligibilityChecks += 1;
      if (!await attendanceEligible(this.transactionContext)) return 'attendance_required' as const;
    }
    this.rows.push(session);
    return 'created' as const;
  }
  async revokeByTokenHash(tokenHash: string, at: Date) {
    const row = this.rows.find((item) => item.tokenHash === tokenHash);
    if (row) row.revokedAt = at;
    return Boolean(row);
  }
  async revokeEmployee(employeeId: number, at: Date) {
    for (const row of this.rows) if (row.employeeId === employeeId) row.revokedAt = at;
  }
  async findActiveByTokenHash(tokenHash: string) {
    return this.rows.find((row) => row.tokenHash === tokenHash && row.revokedAt === null) ?? null;
  }
}

class MemoryAttempts {
  readonly rows: Array<{ actorType: string; identifier: string; succeeded: boolean; reason: string | null }> = [];
  async record(attempt: (typeof this.rows)[number]) { this.rows.push(attempt); }
}

const employee = {
  id: 7,
  code: 12,
  personalPhone: '01012345678',
  pinHash: '',
  deletedAt: null,
  employmentStatus: 'active' as const,
  credentialVersion: 1,
};
const installationMarker = 'marker-marker-123';

let adminHash = '';
let employeePinHash = '';

beforeAll(async () => {
  adminHash = await hash('correct horse battery staple');
  employeePinHash = await hash('0123');
});

const makeService = (overrides: { deviceActive?: boolean; deviceCurrent?: boolean; attendanceOpen?: boolean; employeeCurrent?: boolean; employmentStatus?: 'active' | 'inactive' } = {}) => {
  const sessions = new MemorySessions();
  sessions.employeeCurrent = overrides.employeeCurrent ?? true;
  const attempts = new MemoryAttempts();
  let tokenNumber = 0;
  let deviceVerificationCount = 0;
  let attendanceContext: unknown;
  let attendanceOpen = overrides.attendanceOpen ?? true;
  const createAuthService = Reflect.get(auth, 'createAuthService');
  expect(createAuthService).toBeTypeOf('function');

  return {
    sessions,
    attempts,
    get deviceVerificationCount() { return deviceVerificationCount; },
    get attendanceContext() { return attendanceContext; },
    setAttendanceOpen(value: boolean) { attendanceOpen = value; },
    service: createAuthService({
      adminCredentials: {
        async findByEmail(email: string) {
          return email.toLowerCase() === 'admin@capella.test'
            ? { email: 'admin@capella.test', passwordHash: adminHash }
            : null;
        },
      },
      sessions,
      attempts,
      employees: {
        async findByCode(code: number) {
          return code === employee.code ? { ...employee, employmentStatus: overrides.employmentStatus ?? 'active', pinHash: employeePinHash } : null;
        },
      },
      personalDevices: {
        async verify(employeeId: number, marker: string) {
          deviceVerificationCount += 1;
          return employeeId === employee.id && marker === installationMarker && (overrides.deviceActive ?? true)
            ? { id: 4 }
            : null;
        },
        async isActiveEmployeeDevice(deviceId: number, employeeId: number, context: unknown) {
          expect(context).toBe(sessions.transactionContext);
          return deviceId === 4 && employeeId === employee.id && (overrides.deviceCurrent ?? true);
        },
      },
      attendance: {
        async hasOpenSession(employeeId: number, context?: unknown) {
          attendanceContext = context;
          return employeeId === employee.id && attendanceOpen;
        },
      },
      tokenFactory: () => `opaque-token-${++tokenNumber}`,
      now: () => new Date('2026-07-17T10:00:00.000Z'),
    }),
  };
};

describe('authentication service', () => {
  it('creates independent sessions for valid admin logins', async () => {
    const { service, sessions } = makeService();

    const first = await service.loginAdmin('admin@capella.test', 'correct horse battery staple');
    const second = await service.loginAdmin('admin@capella.test', 'correct horse battery staple');

    expect(first.token).not.toBe(second.token);
    expect(sessions.rows).toHaveLength(2);
    expect(sessions.rows.every((row) => row.actorType === 'admin')).toBe(true);
    expect(sessions.rows.some((row) => row.tokenHash === first.token)).toBe(false);
  });

  it('rejects invalid admin credentials and records every attempt without locking', async () => {
    const { service, sessions, attempts } = makeService();

    await expect(service.loginAdmin('admin@capella.test', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(service.loginAdmin('admin@capella.test', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(sessions.rows).toHaveLength(0);
    expect(attempts.rows).toHaveLength(2);
    expect(attempts.rows.every((row) => !row.succeeded)).toBe(true);
  });

  it('rejects unknown admin emails with the same invalid-credentials error', async () => {
    const { service, sessions, attempts } = makeService();

    await expect(service.loginAdmin('nobody@capella.test', 'whatever')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(sessions.rows).toHaveLength(0);
    expect(attempts.rows).toEqual([
      { actorType: 'admin', identifier: 'nobody@capella.test', succeeded: false, reason: 'INVALID_CREDENTIALS' },
    ]);
  });

  it('logs out only the presented session', async () => {
    const { service, sessions } = makeService();
    const first = await service.loginAdmin('admin@capella.test', 'correct horse battery staple');
    const second = await service.loginAdmin('admin@capella.test', 'correct horse battery staple');

    await service.logout(first.token);

    await expect(service.authenticate(first.token)).resolves.toBeNull();
    await expect(service.authenticate(second.token)).resolves.toMatchObject({ actorType: 'admin' });
    expect(sessions.rows.filter((row) => row.revokedAt)).toHaveLength(1);
  });

  it('creates employee self-service only with matching identity, device, and open attendance', async () => {
    const setup = makeService();

    const result = await setup.service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker,
    });

    expect(result.actor).toEqual({ type: 'employee' });
    expect(setup.sessions.attendanceEligibilityChecks).toBe(1);
    expect(setup.sessions.deviceEligibilityChecks).toBe(1);
    expect(setup.attendanceContext).toBe(setup.sessions.transactionContext);
    await expect(setup.service.authenticate(result.token)).resolves.toMatchObject({ actorType: 'employee', employeeId: 7 });
  });

  it.each([
    ['wrong PIN', {}, { pin: '9999' }, 'INVALID_CREDENTIALS'],
    ['wrong phone', {}, { personalPhone: '01100000000' }, 'INVALID_CREDENTIALS'],
    ['unregistered device', { deviceActive: false }, {}, 'DEVICE_NOT_REGISTERED'],
    ['no open attendance', { attendanceOpen: false }, {}, 'ACTIVE_ATTENDANCE_REQUIRED'],
  ])('rejects employee login with %s and records it', async (_name, overrides, inputOverrides, code) => {
    const { service, attempts } = makeService(overrides);

    await expect(service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker,
      ...inputOverrides,
    })).rejects.toMatchObject({ code });

    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0]?.succeeded).toBe(false);
  });

  it('rejects login for an inactive employee while leaving the paired device unchanged', async () => {
    const { service, sessions, attempts } = makeService({ employmentStatus: 'inactive' });

    await expect(service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker,
    })).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE' });

    expect(sessions.rows).toHaveLength(0);
    expect(attempts.rows[0]).toMatchObject({ reason: 'EMPLOYEE_INACTIVE' });
  });

  it.each([
    ['wrong PIN', { pin: '9999' }],
    ['wrong phone', { personalPhone: '01100000000' }],
  ])('checks the browser marker when an existing employee submits a %s', async (_name, inputOverrides) => {
    const setup = makeService();

    await expect(setup.service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker,
      ...inputOverrides,
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(setup.deviceVerificationCount).toBe(1);
  });

  it('checks the browser marker when the claimed employee code is unknown', async () => {
    const setup = makeService();

    await expect(setup.service.loginEmployee({
      employeeCode: 999,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker,
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(setup.deviceVerificationCount).toBe(1);
  });

  it('revokes every employee session after a PIN reset', async () => {
    const { service } = makeService();
    const first = await service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', installationMarker });
    const second = await service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', installationMarker });

    await service.revokeEmployeeSessions(7);

    await expect(service.authenticate(first.token)).resolves.toBeNull();
    await expect(service.authenticate(second.token)).resolves.toBeNull();
  });

  it('rejects login when employee credentials change before session creation', async () => {
    const { service, sessions, attempts } = makeService({ employeeCurrent: false });
    await expect(service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', installationMarker })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(sessions.rows).toHaveLength(0);
    expect(attempts.rows).toEqual([expect.objectContaining({ succeeded: false, reason: 'INVALID_CREDENTIALS' })]);
  });

  it('rejects login when the verified device is revoked before session creation', async () => {
    const { service, sessions, attempts } = makeService({ deviceCurrent: false });

    await expect(service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker,
    })).rejects.toMatchObject({ code: 'DEVICE_NOT_REGISTERED' });
    expect(sessions.rows).toHaveLength(0);
    expect(sessions.deviceEligibilityChecks).toBe(1);
    expect(attempts.rows).toEqual([expect.objectContaining({
      succeeded: false,
      reason: 'DEVICE_NOT_REGISTERED',
    })]);
  });

  it('rejects and revokes an existing employee token after attendance expires', async () => {
    const setup = makeService();
    const login = await setup.service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker,
    });
    setup.setAttendanceOpen(false);

    await expect(setup.service.authenticate(login.token)).resolves.toBeNull();
    expect(setup.sessions.rows[0]?.revokedAt).not.toBeNull();
  });

  it('does not record infrastructure failures as invalid credentials', async () => {
    const { service, sessions, attempts } = makeService();
    const failure = new Error('database unavailable');
    sessions.createEmployeeIfCurrent = async () => { throw failure; };

    await expect(service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', installationMarker })).rejects.toBe(failure);
    expect(attempts.rows).toHaveLength(0);
  });
});

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

  async create(session: Session) { this.rows.push(session); }
  async createEmployeeIfCurrent(session: Session) { if (!this.employeeCurrent) return false; this.rows.push(session); return true; }
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
  credentialVersion: 1,
};
const validProof = {
  challengeId: '00000000-0000-4000-8000-000000000001', installationMarker: 'marker-marker-123',
  response: { id: 'valid-proof', rawId: 'valid-proof', type: 'public-key' as const, response: { clientDataJSON: 'data', authenticatorData: 'auth', signature: 'signature' }, clientExtensionResults: {} },
};

let adminHash = '';
let employeePinHash = '';

beforeAll(async () => {
  adminHash = await hash('correct horse battery staple');
  employeePinHash = await hash('0123');
});

const makeService = (overrides: { deviceActive?: boolean; attendanceOpen?: boolean; employeeCurrent?: boolean } = {}) => {
  const sessions = new MemorySessions();
  sessions.employeeCurrent = overrides.employeeCurrent ?? true;
  const attempts = new MemoryAttempts();
  let tokenNumber = 0;
  let deviceVerificationCount = 0;
  const createAuthService = Reflect.get(auth, 'createAuthService');
  expect(createAuthService).toBeTypeOf('function');

  return {
    sessions,
    attempts,
    get deviceVerificationCount() { return deviceVerificationCount; },
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
          return code === employee.code ? { ...employee, pinHash: employeePinHash } : null;
        },
      },
      personalDevices: {
        async beginAuthentication() { return (overrides.deviceActive ?? true) ? { challengeId: 'challenge', options: {} } : null; },
        async verify(employeeId: number, proof: typeof validProof) {
          deviceVerificationCount += 1;
          return employeeId === employee.id && proof.response.id === 'valid-proof' && (overrides.deviceActive ?? true);
        },
      },
      attendance: {
        async hasOpenSession(employeeId: number) {
          return employeeId === employee.id && (overrides.attendanceOpen ?? true);
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
    const { service } = makeService();

    const result = await service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      deviceProof: validProof,
    });

    expect(result.actor).toEqual({ type: 'employee' });
    await expect(service.authenticate(result.token)).resolves.toMatchObject({ actorType: 'employee', employeeId: 7 });
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
      deviceProof: validProof,
      ...inputOverrides,
    })).rejects.toMatchObject({ code });

    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0]?.succeeded).toBe(false);
  });

  it.each([
    ['wrong PIN', { pin: '9999' }],
    ['wrong phone', { personalPhone: '01100000000' }],
  ])('consumes device proof when an existing employee submits a %s', async (_name, inputOverrides) => {
    const setup = makeService();

    await expect(setup.service.loginEmployee({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      deviceProof: validProof,
      ...inputOverrides,
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(setup.deviceVerificationCount).toBe(1);
  });

  it('consumes device proof when the claimed employee code is unknown', async () => {
    const setup = makeService();

    await expect(setup.service.loginEmployee({
      employeeCode: 999,
      pin: '0123',
      personalPhone: '01012345678',
      deviceProof: validProof,
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(setup.deviceVerificationCount).toBe(1);
  });

  it('revokes every employee session after a PIN reset', async () => {
    const { service } = makeService();
    const first = await service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', deviceProof: validProof });
    const second = await service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', deviceProof: validProof });

    await service.revokeEmployeeSessions(7);

    await expect(service.authenticate(first.token)).resolves.toBeNull();
    await expect(service.authenticate(second.token)).resolves.toBeNull();
  });

  it('uses the same public error for unknown employees and employees without a registered device', async () => {
    await expect(makeService().service.beginEmployeeDeviceAuthentication(999, 'marker-marker-123')).rejects.toMatchObject({ code: 'DEVICE_NOT_REGISTERED' });
    await expect(makeService({ deviceActive: false }).service.beginEmployeeDeviceAuthentication(12, 'marker-marker-123')).rejects.toMatchObject({ code: 'DEVICE_NOT_REGISTERED' });
  });

  it('rejects login when employee credentials change before session creation', async () => {
    const { service, sessions, attempts } = makeService({ employeeCurrent: false });
    await expect(service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', deviceProof: validProof })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(sessions.rows).toHaveLength(0);
    expect(attempts.rows).toEqual([expect.objectContaining({ succeeded: false, reason: 'INVALID_CREDENTIALS' })]);
  });

  it('does not record infrastructure failures as invalid credentials', async () => {
    const { service, sessions, attempts } = makeService();
    const failure = new Error('database unavailable');
    sessions.createEmployeeIfCurrent = async () => { throw failure; };

    await expect(service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', deviceProof: validProof })).rejects.toBe(failure);
    expect(attempts.rows).toHaveLength(0);
  });
});

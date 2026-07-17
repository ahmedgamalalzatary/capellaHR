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

  async create(session: Session) { this.rows.push(session); }
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
};

let adminHash = '';
let employeePinHash = '';

beforeAll(async () => {
  adminHash = await hash('correct horse battery staple');
  employeePinHash = await hash('0123');
});

const makeService = (overrides: { deviceActive?: boolean; attendanceOpen?: boolean } = {}) => {
  const sessions = new MemorySessions();
  const attempts = new MemoryAttempts();
  let tokenNumber = 0;
  const createAuthService = Reflect.get(auth, 'createAuthService');
  expect(createAuthService).toBeTypeOf('function');

  return {
    sessions,
    attempts,
    service: createAuthService({
      admin: { email: 'admin@capella.test', passwordHash: adminHash },
      sessions,
      attempts,
      employees: {
        async findByCode(code: number) {
          return code === employee.code ? { ...employee, pinHash: employeePinHash } : null;
        },
      },
      personalDevices: {
        async verify(employeeId: number, proof: Record<string, unknown>) {
          return employeeId === employee.id && proof.id === 'valid-proof' && (overrides.deviceActive ?? true);
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
      deviceProof: { id: 'valid-proof' },
    });

    expect(result.actor).toEqual({ type: 'employee', employeeId: 7 });
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
      deviceProof: { id: 'valid-proof' },
      ...inputOverrides,
    })).rejects.toMatchObject({ code });

    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0]?.succeeded).toBe(false);
  });

  it('revokes every employee session after a PIN reset', async () => {
    const { service } = makeService();
    const first = await service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', deviceProof: { id: 'valid-proof' } });
    const second = await service.loginEmployee({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', deviceProof: { id: 'valid-proof' } });

    await service.revokeEmployeeSessions(7);

    await expect(service.authenticate(first.token)).resolves.toBeNull();
    await expect(service.authenticate(second.token)).resolves.toBeNull();
  });
});

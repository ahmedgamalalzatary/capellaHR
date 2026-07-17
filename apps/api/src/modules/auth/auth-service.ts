import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { verify } from 'argon2';

export type ActorType = 'admin' | 'employee';

export type StoredSession = {
  id: string;
  tokenHash: string;
  actorType: ActorType;
  employeeId: number | null;
  revokedAt: Date | null;
};

export interface SessionRepository {
  create(session: StoredSession): Promise<void>;
  findActiveByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  revokeByTokenHash(tokenHash: string, at: Date): Promise<boolean>;
  revokeEmployee(employeeId: number, at: Date): Promise<void>;
}

export interface AttemptRepository {
  record(attempt: {
    actorType: ActorType;
    identifier: string;
    succeeded: boolean;
    reason: string | null;
  }): Promise<void>;
}

export interface EmployeeIdentity {
  id: number;
  code: number;
  personalPhone: string;
  pinHash: string;
  deletedAt: Date | null;
}

export interface AuthServiceDependencies {
  admin: { email: string; passwordHash: string };
  sessions: SessionRepository;
  attempts: AttemptRepository;
  employees: { findByCode(code: number): Promise<EmployeeIdentity | null> };
  personalDevices: { verify(employeeId: number, proof: Record<string, unknown>): Promise<boolean> };
  attendance: { hasOpenSession(employeeId: number): Promise<boolean> };
  tokenFactory?: () => string;
  now?: () => Date;
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const safelyVerifyHash = async (storedHash: string, value: string) => {
  try {
    return await verify(storedHash, value);
  } catch {
    return false;
  }
};

export const createAuthService = (dependencies: AuthServiceDependencies) => {
  const now = dependencies.now ?? (() => new Date());
  const tokenFactory = dependencies.tokenFactory ?? (() => randomBytes(32).toString('base64url'));

  const createSession = async (actorType: ActorType, employeeId: number | null) => {
    const token = tokenFactory();
    await dependencies.sessions.create({
      id: randomUUID(),
      tokenHash: hashToken(token),
      actorType,
      employeeId,
      revokedAt: null,
    });
    return token;
  };

  return {
    async loginAdmin(email: string, password: string) {
      const valid = email.toLowerCase() === dependencies.admin.email.toLowerCase()
        && await safelyVerifyHash(dependencies.admin.passwordHash, password);
      await dependencies.attempts.record({
        actorType: 'admin', identifier: email, succeeded: valid, reason: valid ? null : 'INVALID_CREDENTIALS',
      });
      if (!valid) throw new AuthError('INVALID_CREDENTIALS', 'بيانات تسجيل الدخول غير صحيحة');
      return { token: await createSession('admin', null), actor: { type: 'admin' as const } };
    },

    async loginEmployee(input: { employeeCode: number; pin: string; personalPhone: string; deviceProof: Record<string, unknown> }) {
      const identity = await dependencies.employees.findByCode(input.employeeCode);
      const identityValid = identity !== null
        && identity.deletedAt === null
        && identity.personalPhone === input.personalPhone
        && await safelyVerifyHash(identity.pinHash, input.pin);

      let reason: string | null = identityValid ? null : 'INVALID_CREDENTIALS';
      if (identityValid && !await dependencies.personalDevices.verify(identity.id, input.deviceProof)) {
        reason = 'DEVICE_NOT_REGISTERED';
      }
      if (identityValid && reason === null && !await dependencies.attendance.hasOpenSession(identity.id)) {
        reason = 'ACTIVE_ATTENDANCE_REQUIRED';
      }

      await dependencies.attempts.record({
        actorType: 'employee',
        identifier: String(input.employeeCode),
        succeeded: reason === null,
        reason,
      });
      if (reason !== null) throw new AuthError(reason, 'تعذر تسجيل الدخول');

      const employeeId = identity!.id;
      return {
        token: await createSession('employee', employeeId),
        actor: { type: 'employee' as const, employeeId },
      };
    },

    async logout(token: string) {
      return dependencies.sessions.revokeByTokenHash(hashToken(token), now());
    },

    async authenticate(token: string) {
      if (!token) return null;
      return dependencies.sessions.findActiveByTokenHash(hashToken(token));
    },

    async revokeEmployeeSessions(employeeId: number) {
      await dependencies.sessions.revokeEmployee(employeeId, now());
    },
  };
};

export type AuthService = ReturnType<typeof createAuthService>;

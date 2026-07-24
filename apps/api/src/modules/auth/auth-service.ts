import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { verify } from 'argon2';

export type ActorType = 'admin' | 'employee';

type StoredSession = {
  id: string;
  tokenHash: string;
  actorType: ActorType;
  employeeId: number | null;
  revokedAt: Date | null;
};

export interface SessionRepository {
  create(session: StoredSession): Promise<void>;
  createEmployeeIfCurrent(
    session: StoredSession,
    credentialVersion: number,
    deviceEligible: (context: unknown) => Promise<boolean>,
    attendanceEligible: (context: unknown) => Promise<boolean>,
  ): Promise<'created' | 'credentials_changed' | 'device_invalid' | 'attendance_required'>;
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
    ipAddress?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  }): Promise<void>;
}

export interface AdminCredentialRepository {
  findByEmail(email: string): Promise<{ email: string; passwordHash: string } | null>;
}

interface EmployeeIdentity {
  id: number;
  code: number;
  personalPhone: string;
  pinHash: string;
  credentialVersion: number;
  deletedAt: Date | null;
  employmentStatus: 'active' | 'inactive';
}

export interface AuthServiceDependencies {
  adminCredentials: AdminCredentialRepository;
  sessions: SessionRepository;
  attempts: AttemptRepository;
  employees: { findByCode(code: number): Promise<EmployeeIdentity | null> };
  personalDevices: {
    verify(employeeId: number, installationMarker: string): Promise<{ id: number } | null>;
    isActiveEmployeeDevice(deviceId: number, employeeId: number, context: unknown): Promise<boolean>;
  };
  attendance: { hasOpenSession(employeeId: number, context?: unknown): Promise<boolean> };
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

// Valid argon2 hash of an unused throwaway value; verified against when no
// credential exists so unknown emails take the same time as wrong passwords.
const TIMING_DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$O33BRlRwoIn+0l0wzrVq7g$jTAOxanRrPw/yvMxeDaz0CHzlDf77QOU6llfV3aKaXs';

const safelyVerifyHash = async (storedHash: string, value: string) => {
  try {
    return await verify(storedHash, value);
  } catch {
    return false;
  }
};

export const createAuthService = (dependencies: AuthServiceDependencies) => {
  type AttemptContext = { ipAddress?: string | null; userAgent?: string | null; requestId?: string | null };
  const now = dependencies.now ?? (() => new Date());
  const tokenFactory = dependencies.tokenFactory ?? (() => randomBytes(32).toString('base64url'));

  const createSession = async (
    actorType: ActorType,
    employeeId: number | null,
    credentialVersion?: number,
    deviceId?: number,
  ) => {
    const token = tokenFactory();
    const session = {
      id: randomUUID(),
      tokenHash: hashToken(token),
      actorType,
      employeeId,
      revokedAt: null,
    };
    if (actorType === 'employee') {
      const result = await dependencies.sessions.createEmployeeIfCurrent(
        session,
        credentialVersion!,
        (context) => dependencies.personalDevices.isActiveEmployeeDevice(deviceId!, employeeId!, context),
        (context) => dependencies.attendance.hasOpenSession(employeeId!, context),
      );
      if (result === 'credentials_changed') throw new AuthError('INVALID_CREDENTIALS', 'تعذر تسجيل الدخول');
      if (result === 'device_invalid') throw new AuthError('DEVICE_NOT_REGISTERED', 'تعذر تسجيل الدخول');
      if (result === 'attendance_required') throw new AuthError('ACTIVE_ATTENDANCE_REQUIRED', 'تعذر تسجيل الدخول');
    } else {
      await dependencies.sessions.create(session);
    }
    return token;
  };

  return {
    async loginAdmin(email: string, password: string, context: AttemptContext = {}) {
      const credential = await dependencies.adminCredentials.findByEmail(email);
      const passwordMatches = await safelyVerifyHash(credential?.passwordHash ?? TIMING_DUMMY_HASH, password);
      const valid = credential !== null && passwordMatches;
      await dependencies.attempts.record({
        actorType: 'admin', identifier: email, succeeded: valid, reason: valid ? null : 'INVALID_CREDENTIALS', ...context,
      });
      if (!valid) throw new AuthError('INVALID_CREDENTIALS', 'بيانات تسجيل الدخول غير صحيحة');
      return { token: await createSession('admin', null), actor: { type: 'admin' as const } };
    },

    async loginEmployee(input: { employeeCode: number; pin: string; personalPhone: string; installationMarker: string }, context: AttemptContext = {}) {
      const identity = await dependencies.employees.findByCode(input.employeeCode);
      const identityValid = identity !== null
        && identity.deletedAt === null
        && identity.employmentStatus === 'active'
        && identity.personalPhone === input.personalPhone
        && await safelyVerifyHash(identity.pinHash, input.pin);
      const verifiedDevice = await dependencies.personalDevices.verify(
        identity?.id ?? 0,
        input.installationMarker,
      );

      let reason: string | null = identity?.deletedAt === null && identity.employmentStatus === 'inactive'
        ? 'EMPLOYEE_INACTIVE'
        : identityValid ? null : 'INVALID_CREDENTIALS';
      if (identityValid && !verifiedDevice) {
        reason = 'DEVICE_NOT_REGISTERED';
      }
      const recordAttempt = (succeeded: boolean, failureReason: string | null) => dependencies.attempts.record({
        actorType: 'employee', identifier: String(input.employeeCode), succeeded, reason: failureReason, ...context,
      });
      if (reason !== null) { await recordAttempt(false, reason); throw new AuthError(reason, 'تعذر تسجيل الدخول'); }

      const employeeId = identity!.id;
      let token: string;
      try { token = await createSession('employee', employeeId, identity!.credentialVersion, verifiedDevice!.id); }
      catch (error) { if (error instanceof AuthError) await recordAttempt(false, error.code); throw error; }
      await recordAttempt(true, null);
      return {
        token,
        actor: { type: 'employee' as const },
      };
    },

    async logout(token: string) {
      return dependencies.sessions.revokeByTokenHash(hashToken(token), now());
    },

    async authenticate(token: string) {
      if (!token) return null;
      const session = await dependencies.sessions.findActiveByTokenHash(hashToken(token));
      if (session?.actorType === 'employee'
        && !await dependencies.attendance.hasOpenSession(session.employeeId!)) {
        await dependencies.sessions.revokeEmployee(session.employeeId!, now());
        return null;
      }
      return session;
    },

    async revokeEmployeeSessions(employeeId: number) {
      await dependencies.sessions.revokeEmployee(employeeId, now());
    },
  };
};

export type AuthService = ReturnType<typeof createAuthService>;

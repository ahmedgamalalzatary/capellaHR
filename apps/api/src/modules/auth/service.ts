import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SignInInput } from "./types";
import type {
  AdminRecord,
  AuthRepository,
  EmployeeRecord,
  SessionRecord
} from "./repository";

type AdminSignInInput = {
  email: string;
  password: string;
};

type AuthServiceOptions = {
  repository: AuthRepository;
  adminSessionTtlHours: number;
  employeeSessionTtlHours?: number;
};

type AdminActor = {
  id: number;
  role: "admin";
  name: string;
  email: string;
};

type EmployeeActor = {
  id: number;
  role: "employee";
  name: string;
  phone: string;
};

type Actor = AdminActor | EmployeeActor;

type AuthFailure = {
  error: {
    code: "INVALID_CREDENTIALS";
    message: "Invalid email or password";
    details: Record<string, never>;
  };
};

function toActor(admin: AdminRecord): Actor {
  return {
    id: admin.id,
    role: "admin",
    name: admin.name,
    email: admin.email
  };
}

function toEmployeeActor(employee: EmployeeRecord): Actor {
  return {
    id: employee.id,
    role: "employee",
    name: employee.fullName,
    phone: employee.primaryPhone
  };
}

export function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64).toString("hex");

  return `scrypt$${salt}$${derivedKey}`;
}

function verifyPassword(password: string, passwordHash: string) {
  if (passwordHash.startsWith("plain:")) {
    return passwordHash === `plain:${password}`;
  }

  const [algorithm, salt, expectedKey] = passwordHash.split("$");

  if (algorithm !== "scrypt" || !salt || !expectedKey) {
    return false;
  }

  const actualKey = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expectedKey, "hex");

  if (actualKey.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualKey, expectedBuffer);
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function createTokenHash(token: string) {
  return scryptSync(token, "capella-session", 64).toString("hex");
}

export function createAuthService(options: AuthServiceOptions) {
  return {
    async signInAdmin(input: AdminSignInInput) {
      const admin = await options.repository.findAdminByEmail(input.email);

      if (!admin || !verifyPassword(input.password, admin.passwordHash)) {
        return {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password",
            details: {}
          }
        } satisfies AuthFailure;
      }

      const sessionToken = createSessionToken();
      const expiresAt = new Date(Date.now() + options.adminSessionTtlHours * 60 * 60 * 1000);
      const session: SessionRecord = {
        tokenHash: createTokenHash(sessionToken),
        actorId: admin.id,
        actorRole: "admin",
        expiresAt,
        revokedAt: null
      };

      await options.repository.insertSession(session);

      return {
        sessionToken,
        actor: toActor(admin),
        expiresAt
      };
    },

    async signInEmployee(input: SignInInput) {
      const employee = await options.repository.findEmployeeByPhone(input.phone);

      if (
        !employee ||
        employee.softDeletedAt !== null ||
        !verifyPassword(input.password, employee.passwordHash)
      ) {
        return {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password",
            details: {}
          }
        } satisfies AuthFailure;
      }

      const revokedAt = new Date();
      await options.repository.revokeActiveSessionsForActor("employee", employee.id, revokedAt);

      const sessionToken = createSessionToken();
      const expiresAt = new Date(
        Date.now() + (options.employeeSessionTtlHours ?? 12) * 60 * 60 * 1000
      );
      const session: SessionRecord = {
        tokenHash: createTokenHash(sessionToken),
        actorId: employee.id,
        actorRole: "employee",
        expiresAt,
        revokedAt: null
      };

      await options.repository.insertSession(session);

      return {
        sessionToken,
        actor: toEmployeeActor(employee),
        expiresAt
      };
    },

    async getSessionActor(sessionToken: string) {
      const session = await options.repository.findSessionByTokenHash(createTokenHash(sessionToken));

      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
        return null;
      }

      if (session.actorRole === "admin") {
        const admin = await options.repository.findAdminById(session.actorId);

        if (!admin) {
          return null;
        }

        return toActor(admin);
      }

      const employee = await options.repository.findEmployeeById(session.actorId);

      if (!employee || employee.softDeletedAt !== null) {
        return null;
      }

      return toEmployeeActor(employee);
    },

    async getAdminSessionActor(sessionToken: string) {
      const actor = await this.getSessionActor(sessionToken);

      if (!actor || actor.role !== "admin") {
        return null;
      }

      return actor;
    },

    async signOut(sessionToken: string) {
      const revoked = await options.repository.revokeSessionByTokenHash(
        createTokenHash(sessionToken),
        new Date()
      );

      return { revoked };
    }
  };
}

export type { AdminRecord, AuthRepository, EmployeeRecord, SessionRecord } from "./repository";

import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";
import { createMonthLockService } from "../../../../src/modules/month-locks/service";
import type {
  MonthLockRecord,
  MonthLockRepository
} from "../../../../src/modules/month-locks/service";

class InMemoryMonthLockRepository implements MonthLockRepository {
  locks: MonthLockRecord[] = [];
  nextId = 1;

  async listMonthLocks(filters: { monthKey?: string }) {
    return this.locks.filter((lock) => !filters.monthKey || lock.monthKey === filters.monthKey);
  }

  async findMonthLockByMonthKey(monthKey: string) {
    return this.locks.find((lock) => lock.monthKey === monthKey) ?? null;
  }

  async hasOpenSessions() {
    return false;
  }

  async createMonthLock(input: {
    monthKey: string;
    lockedByAdminId: number;
    notes?: string;
  }) {
    const lock: MonthLockRecord = {
      id: this.nextId++,
      monthKey: input.monthKey,
      lockedAt: "2026-07-01T00:00:00.000Z",
      lockedByAdminId: input.lockedByAdminId,
      notes: input.notes ?? null
    };

    this.locks.push(lock);
    return lock;
  }
}

describe("month lock routes", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      monthLockService: createMonthLockService({
        repository: new InMemoryMonthLockRepository(),
        now: () => new Date("2026-07-15T10:00:00.000Z")
      })
    });

    const response = await request(app).get("/month-locks");

    expect(response.status).toBe(401);
  });

  it("lists month locks for admins", async () => {
    const repository = new InMemoryMonthLockRepository();
    repository.locks.push({
      id: 1,
      monthKey: "2026-06",
      lockedAt: "2026-07-01T00:00:00.000Z",
      lockedByAdminId: 1,
      notes: "Closed"
    });
    const app = createApp({
      authService: createAdminAuthService(),
      monthLockService: createMonthLockService({
        repository,
        now: () => new Date("2026-07-15T10:00:00.000Z")
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .get("/month-locks")
      .set("Cookie", cookieHeader)
      .query({ monthKey: "2026-06" });

    expect(response.status).toBe(200);
    expect(response.body.monthLocks).toHaveLength(1);
  });

  it("creates a month lock for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      monthLockService: createMonthLockService({
        repository: new InMemoryMonthLockRepository(),
        now: () => new Date("2026-07-15T10:00:00.000Z")
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .post("/month-locks")
      .set("Cookie", cookieHeader)
      .send({
        monthKey: "2026-06",
        notes: "Closed"
      });

    expect(response.status).toBe(201);
    expect(response.body.monthLock.monthKey).toBe("2026-06");
  });
});

function createAdminAuthService() {
  return createAuthService({
    repository: createInMemoryAuthRepository({
      bootstrapAdmin: {
        name: "Capella Admin",
        email: "admin.test@capella.invalid",
        password: "test-admin-pass-123"
      }
    }),
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin.test@capella.invalid",
    password: "test-admin-pass-123"
  });

  return response.headers["set-cookie"];
}

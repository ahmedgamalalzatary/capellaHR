import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";
import { createAuditLogService } from "../../../../src/modules/audit-logs/service";
import type {
  AuditLogRecord,
  AuditLogRepository
} from "../../../../src/modules/audit-logs/service";

class InMemoryAuditLogRepository implements AuditLogRepository {
  logs: AuditLogRecord[] = [];

  async listAuditLogs() {
    return this.logs;
  }

  async createAuditLog() {
    return {
      id: 0,
      adminId: 0,
      actionType: "create",
      entityType: "attendance",
      entityId: "0",
      entityDisplayName: null,
      reason: null,
      before: null,
      after: null,
      occurredAtUtc: new Date().toISOString()
    };
  }
}

describe("audit log routes", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      auditLogService: createAuditLogService({
        repository: new InMemoryAuditLogRepository()
      })
    });

    const response = await request(app).get("/audit-logs");

    expect(response.status).toBe(401);
  });

  it("lists audit logs for admins", async () => {
    const repository = new InMemoryAuditLogRepository();
    repository.logs.push({
      id: 1,
      adminId: 1,
      actionType: "create",
      entityType: "attendance",
      entityId: "42",
      entityDisplayName: "Ahmed Gamal",
      reason: "manual correction",
      before: null,
      after: { status: "completed" },
      occurredAtUtc: "2026-06-22T08:00:00.000Z"
    });
    const app = createApp({
      authService: createAdminAuthService(),
      auditLogService: createAuditLogService({
        repository
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .get("/audit-logs")
      .set("Cookie", cookieHeader)
      .query({ entityType: "attendance" });

    expect(response.status).toBe(200);
    expect(response.body.auditLogs).toHaveLength(1);
  });
});

function createAdminAuthService() {
  return createAuthService({
    repository: createInMemoryAuthRepository({
      bootstrapAdmin: {
        name: "Capella Admin",
        email: "admin@capella.eg",
        password: "admin1234"
      }
    }),
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin@capella.eg",
    password: "admin1234"
  });

  return response.headers["set-cookie"];
}

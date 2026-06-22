import { describe, expect, it } from "vitest";
import { createBranchService } from "../../../../src/modules/branches/service";
import { InMemoryAuditLogService } from "../audit-logs/audit-log-test.fixtures";
import { InMemoryBranchRepository, validPayload } from "./branch-routes.fixtures";

describe("branch service", () => {
  it("writes an audit log when creating a branch", async () => {
    const repository = new InMemoryBranchRepository();
    const auditLogService = new InMemoryAuditLogService();
    const service = createBranchService({
      repository,
      auditLogService
    });

    const result = await service.createBranch(validPayload(), 1);

    expect(result.name).toBe("Heliopolis");
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "create",
      entityType: "branch",
      entityId: "2"
    });
  });

  it("writes an audit log when updating a branch", async () => {
    const repository = new InMemoryBranchRepository();
    const auditLogService = new InMemoryAuditLogService();
    const service = createBranchService({
      repository,
      auditLogService
    });

    const result = await service.updateBranch(1, { name: "Nasr City Updated" }, 1);

    expect("error" in result).toBe(false);
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "update",
      entityType: "branch",
      entityId: "1"
    });
  });
});

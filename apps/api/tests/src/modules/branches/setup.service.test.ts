import { describe, expect, it } from "vitest";
import { createBranchService } from "../../../../src/modules/branches/service";
import { InMemoryAuditLogService } from "../audit-logs/audit-log-test.fixtures";
import {
  InMemoryBranchRepository,
  assertBranchDeviceState,
  validBranchSetupCompletionInput,
  validBranchSetupLinkInput
} from "./branch-routes.fixtures";

describe("branch setup service", () => {
  it("creates a one-hour setup link for a branch", async () => {
    const repository = new InMemoryBranchRepository();
    const auditLogService = new InMemoryAuditLogService();
    const service = createBranchService({
      repository,
      auditLogService
    });

    const result = await service.createSetupLink(1, validBranchSetupLinkInput(), 1);

    assertBranchDeviceState(result);
    expect(result.pendingSetup?.deviceLabel).toBe("Reception iPad");
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "setup_link_create",
      entityType: "branch_device",
      entityId: "1"
    });
  });

  it("completes setup and promotes the branch to completed", async () => {
    const repository = new InMemoryBranchRepository();
    const service = createBranchService({
      repository
    });
    const setup = await service.createSetupLink(1, validBranchSetupLinkInput(), 1);
    assertBranchDeviceState(setup);

    const result = await service.completeSetup(setup.pendingSetup!.token, validBranchSetupCompletionInput());

    assertBranchDeviceState(result);
    expect(result.activeDevice?.browserFingerprint).toBe("branch-browser");
    expect(result.branch.setupStatus).toBe("completed");
  });

  it("revokes pending setup links for a branch", async () => {
    const repository = new InMemoryBranchRepository();
    const auditLogService = new InMemoryAuditLogService();
    const service = createBranchService({
      repository,
      auditLogService
    });
    await service.createSetupLink(1, validBranchSetupLinkInput(), 1);

    const result = await service.revokeSetupLink(1, 1);

    expect(result).toEqual({ success: true });
    expect(auditLogService.logs[1]).toMatchObject({
      actionType: "setup_link_revoke",
      entityType: "branch_device",
      entityId: "1"
    });
  });
});

import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createBranchService } from "../../../../src/modules/branches/service";
import {
  InMemoryBranchRepository,
  createAdminAuthService,
  signInAdmin,
  validBranchSetupCompletionInput,
  validBranchSetupLinkInput
} from "./branch-routes.fixtures";

describe("branch setup routes", () => {
  it("creates a branch setup link for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      branchService: createBranchService({
        repository: new InMemoryBranchRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .post("/branches/1/setup-links")
      .set("Cookie", adminCookie)
      .send(validBranchSetupLinkInput());

    expect(response.status).toBe(201);
    expect(response.body.branchDevice.pendingSetup.deviceLabel).toBe("Reception iPad");
  });

  it("completes branch setup by token", async () => {
    const repository = new InMemoryBranchRepository();
    const service = createBranchService({ repository });
    const setup = await service.createSetupLink(1, validBranchSetupLinkInput(), 1);
    if ("error" in setup || !setup.pendingSetup) {
      throw new Error("Expected pending setup link");
    }
    const app = createApp({
      branchService: service
    });

    const response = await request(app)
      .post(`/branch-setup/${setup.pendingSetup.token}/complete`)
      .send(validBranchSetupCompletionInput());

    expect(response.status).toBe(200);
    expect(response.body.branchDevice.branch.setupStatus).toBe("completed");
  });

  it("revokes pending branch setup links for admins", async () => {
    const repository = new InMemoryBranchRepository();
    const service = createBranchService({ repository });
    await service.createSetupLink(1, validBranchSetupLinkInput(), 1);
    const app = createApp({
      authService: createAdminAuthService(),
      branchService: service
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .delete("/branches/1/setup-links")
      .set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });
});

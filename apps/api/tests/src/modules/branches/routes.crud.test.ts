import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createBranchService } from "../../../../src/modules/branches/service";
import {
  InMemoryBranchRepository,
  createAdminAuthService,
  signInAdmin,
  validPayload
} from "./branch-routes.fixtures";

describe("branch routes (crud)", () => {
  it("creates a branch for authenticated admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      branchService: createBranchService({
        repository: new InMemoryBranchRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).post("/branches").set("Cookie", adminCookie).send(validPayload());

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      branch: {
        id: 2,
        name: "Heliopolis",
        address: "Cairo",
        gpsLatitude: "30.1000000",
        gpsLongitude: "31.3000000",
        gpsRadiusMeters: 150,
        allowedIpCidr: "192.168.10.0/24",
        registeredDeviceToken: null,
        setupStatus: "setup_pending"
      }
    });
  });

  it("lists branches using the shared query contract", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      branchService: createBranchService({
        repository: new InMemoryBranchRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/branches").set("Cookie", adminCookie).query({
      page: "1",
      pageSize: "10",
      search: "nasr"
    });

    expect(response.status).toBe(200);
    expect(response.body.branches).toEqual({
      items: [
        expect.objectContaining({
          name: "Nasr City"
        })
      ],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1
      }
    });
  });

  it("gets a single branch by id", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      branchService: createBranchService({
        repository: new InMemoryBranchRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/branches/1").set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.branch.name).toBe("Nasr City");
  });

  it("updates a branch", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      branchService: createBranchService({
        repository: new InMemoryBranchRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .patch("/branches/1")
      .set("Cookie", adminCookie)
      .send({
        name: "Nasr City Updated",
        setupStatus: "completed"
      });

    expect(response.status).toBe(200);
    expect(response.body.branch.name).toBe("Nasr City Updated");
    expect(response.body.branch.setupStatus).toBe("completed");
  });
});

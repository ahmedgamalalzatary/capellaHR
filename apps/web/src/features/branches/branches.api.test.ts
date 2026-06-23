import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/lib/api-client";
import { branchesApi } from "@/features/branches/branches.api";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const branch = {
  id: 1,
  name: "فرع المعادي",
  address: "المعادي",
  gpsLatitude: "29.9602",
  gpsLongitude: "31.2569",
  gpsRadiusMeters: 100,
  allowedIpCidr: "196.221.0.0/16",
  registeredDeviceToken: null,
  setupStatus: "setup_pending"
};

const pagination = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

describe("branchesApi.list", () => {
  it("GETs /branches with pagination/search query and returns items", async () => {
    let receivedUrl: URL | undefined;
    server.use(
      http.get(apiUrl("/branches"), ({ request }) => {
        receivedUrl = new URL(request.url);
        return HttpResponse.json({ branches: { items: [branch], pagination } });
      })
    );

    const result = await branchesApi.list({ page: 2, pageSize: 10, search: "معادي" });

    expect(receivedUrl?.searchParams.get("page")).toBe("2");
    expect(receivedUrl?.searchParams.get("pageSize")).toBe("10");
    expect(receivedUrl?.searchParams.get("search")).toBe("معادي");
    expect(result.branches.items).toHaveLength(1);
    expect(result.branches.pagination.total).toBe(1);
  });
});

describe("branchesApi.get", () => {
  it("GETs /branches/:id and returns the branch", async () => {
    server.use(http.get(apiUrl("/branches/1"), () => HttpResponse.json({ branch })));

    const result = await branchesApi.get(1);

    expect(result.branch.id).toBe(1);
  });

  it("throws ApiError(404) when the branch is missing", async () => {
    server.use(
      http.get(apiUrl("/branches/999"), () =>
        HttpResponse.json(
          { error: { code: "BRANCH_NOT_FOUND", message: "Branch not found" } },
          { status: 404 }
        )
      )
    );

    await expect(branchesApi.get(999)).rejects.toMatchObject(
      { name: "ApiError", status: 404 } satisfies Partial<ApiError>
    );
  });
});

describe("branchesApi.create", () => {
  it("POSTs the branch payload to /branches and returns the created branch", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(apiUrl("/branches"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ branch }, { status: 201 });
      })
    );

    const result = await branchesApi.create({
      name: "فرع المعادي",
      address: "المعادي",
      gpsLatitude: 29.9602,
      gpsLongitude: 31.2569,
      gpsRadiusMeters: 100,
      allowedIpCidr: "196.221.0.0/16"
    });

    expect(receivedBody).toMatchObject({ name: "فرع المعادي", gpsRadiusMeters: 100 });
    expect(result.branch.id).toBe(1);
  });
});

describe("branchesApi.update", () => {
  it("PATCHes /branches/:id with a partial payload", async () => {
    let receivedBody: unknown;
    server.use(
      http.patch(apiUrl("/branches/1"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ branch: { ...branch, name: "فرع محدث" } });
      })
    );

    const result = await branchesApi.update(1, { name: "فرع محدث" });

    expect(receivedBody).toEqual({ name: "فرع محدث" });
    expect(result.branch.name).toBe("فرع محدث");
  });
});

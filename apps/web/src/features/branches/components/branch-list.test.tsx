import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders, screen } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { BranchList } from "@/features/branches/components/branch-list";

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

describe("BranchList", () => {
  it("renders branch rows from the API", async () => {
    server.use(
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({
          branches: { items: [branch], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }
        })
      )
    );

    renderWithProviders(<BranchList />);

    expect(await screen.findByText("فرع المعادي")).toBeInTheDocument();
    expect(screen.getByText("المعادي")).toBeInTheDocument();
  });

  it("shows an empty state when there are no branches", async () => {
    server.use(
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({
          branches: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }
        })
      )
    );

    renderWithProviders(<BranchList />);

    expect(await screen.findByText("لا توجد فروع")).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    server.use(
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({ error: { code: "SERVER_ERROR", message: "x" } }, { status: 500 })
      )
    );

    renderWithProviders(<BranchList />);

    expect(await screen.findByText("تعذّر تحميل الفروع")).toBeInTheDocument();
  });
});

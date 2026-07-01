import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import AdminAttendancePage from "@/app/(admin)/admin/attendance/page";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/attendance",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

const branch = {
  id: 3,
  name: "فرع الزمالك",
  address: "القاهرة",
  gpsLatitude: "30.0626",
  gpsLongitude: "31.2197",
  gpsRadiusMeters: 150,
  allowedIpCidr: "192.168.1.0/24",
  registeredDeviceToken: "device-token",
  setupStatus: "completed"
};

const session = {
  id: 11,
  employeeId: 7,
  employeeName: "سارة محمود",
  branchId: 3,
  status: "completed",
  checkInAtUtc: "2026-06-30T06:00:00.000Z",
  checkOutAtUtc: "2026-06-30T14:00:00.000Z",
  checkInLatitude: 30.0626,
  checkInLongitude: 31.2197,
  checkInIpAddress: "192.168.1.42",
  deviceId: "admin-manual-entry",
  branchPolicySnapshot: {},
  adminReason: "تصحيح وردية",
  createdByAdminId: 1,
  updatedByAdminId: null
};

describe("AdminAttendancePage", () => {
  it("renders admin attendance sessions with filters and correction actions", async () => {
    server.use(
      http.get(apiUrl("/admin/attendance"), ({ request }) => {
        const url = new URL(request.url);

        expect(url.searchParams.get("page")).toBe("1");
        expect(url.searchParams.get("pageSize")).toBe("20");

        return HttpResponse.json({
          sessions: {
            items: [session],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
          }
        });
      }),
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({
          branches: {
            items: [branch],
            pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
          }
        })
      )
    );

    renderWithProviders(<AdminAttendancePage />);

    expect(await screen.findByRole("heading", { name: "إدارة الحضور" })).toBeInTheDocument();
    expect(await screen.findByText("سارة محمود")).toBeInTheDocument();
    expect(screen.getByText("فرع الزمالك")).toBeInTheDocument();
    expect(screen.getByText("مكتملة")).toBeInTheDocument();
    expect(screen.getByText("تصحيح وردية")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إضافة حركة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تعديل حركة سارة محمود" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حذف حركة سارة محمود" })).toBeInTheDocument();
  });

  it("creates a manual attendance session with a required reason", async () => {
    let receivedBody: unknown;

    server.use(
      http.get(apiUrl("/admin/attendance"), () =>
        HttpResponse.json({
          sessions: {
            items: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }
          }
        })
      ),
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({
          branches: {
            items: [branch],
            pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
          }
        })
      ),
      http.post(apiUrl("/admin/attendance"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ session }, { status: 201 });
      })
    );

    renderWithProviders(<AdminAttendancePage />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "إضافة حركة" }));
    await userEvent.setup().type(screen.getByLabelText("رقم الموظف"), "7");
    await userEvent.setup().type(screen.getByLabelText("رقم الفرع"), "3");
    await userEvent.setup().type(screen.getByLabelText("وقت الحضور"), "2026-06-30T08:00");
    await userEvent.setup().type(screen.getByLabelText("وقت الانصراف"), "2026-06-30T16:00");
    await userEvent.setup().type(screen.getByLabelText("سبب التعديل"), "تصحيح وردية");
    await userEvent.setup().click(screen.getByRole("button", { name: "حفظ الحركة" }));

    await waitFor(() =>
      expect(receivedBody).toMatchObject({
        employeeId: 7,
        branchId: 3,
        reason: "تصحيح وردية"
      })
    );
  });

  it("updates an attendance session with a correction reason", async () => {
    let receivedBody: unknown;

    server.use(
      http.get(apiUrl("/admin/attendance"), () =>
        HttpResponse.json({
          sessions: {
            items: [session],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
          }
        })
      ),
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({
          branches: {
            items: [branch],
            pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
          }
        })
      ),
      http.patch(apiUrl("/admin/attendance/11"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ session });
      })
    );

    renderWithProviders(<AdminAttendancePage />);

    await userEvent.setup().click(
      await screen.findByRole("button", { name: "تعديل حركة سارة محمود" })
    );
    await userEvent.setup().clear(screen.getByLabelText("سبب التعديل"));
    await userEvent.setup().type(screen.getByLabelText("سبب التعديل"), "تعديل وقت الانصراف");
    await userEvent.setup().click(screen.getByRole("button", { name: "حفظ الحركة" }));

    await waitFor(() =>
      expect(receivedBody).toMatchObject({
        branchId: 3,
        checkInAt: "2026-06-30T06:00:00.000Z",
        checkOutAt: "2026-06-30T14:00:00.000Z",
        reason: "تعديل وقت الانصراف"
      })
    );
  });

  it("deletes an attendance session only after capturing a reason", async () => {
    let receivedBody: unknown;

    server.use(
      http.get(apiUrl("/admin/attendance"), () =>
        HttpResponse.json({
          sessions: {
            items: [session],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
          }
        })
      ),
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({
          branches: {
            items: [branch],
            pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
          }
        })
      ),
      http.delete(apiUrl("/admin/attendance/11"), async ({ request }) => {
        receivedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      })
    );

    renderWithProviders(<AdminAttendancePage />);

    await userEvent.setup().click(
      await screen.findByRole("button", { name: "حذف حركة سارة محمود" })
    );
    await userEvent.setup().type(screen.getByLabelText("سبب الحذف"), "إدخال مكرر");
    await userEvent.setup().click(screen.getByRole("button", { name: "تأكيد الحذف" }));

    await waitFor(() => expect(receivedBody).toEqual({ reason: "إدخال مكرر" }));
  });
});

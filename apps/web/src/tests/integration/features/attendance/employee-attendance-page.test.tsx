import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import EmployeeAttendancePage from "@/app/(employee)/attendance/page";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

const openSession = {
  id: 1,
  employeeId: 2,
  branchId: 1,
  status: "open",
  checkInAtUtc: "2026-06-22T06:00:00.000Z",
  checkOutAtUtc: null,
  checkInLatitude: 30.04442,
  checkInLongitude: 31.235712,
  checkInIpAddress: "192.168.1.42",
  deviceId: "personal-device-1",
  branchPolicySnapshot: {
    allowedIpCidr: "192.168.1.0/24"
  }
};

const completedSession = {
  ...openSession,
  id: 2,
  status: "completed",
  checkInAtUtc: "2026-06-21T06:00:00.000Z",
  checkOutAtUtc: "2026-06-21T14:00:00.000Z"
};

function mockGeolocation(latitude = 30.04442, longitude = 31.235712) {
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({
      coords: {
        latitude,
        longitude,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: Date.now()
    } as GeolocationPosition);
  });

  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition }
  });

  return getCurrentPosition;
}

describe("EmployeeAttendancePage", () => {
  it("disables attendance submission when current state fails to load", async () => {
    const getCurrentPosition = mockGeolocation();
    server.use(
      http.get(apiUrl("/attendance/me"), () =>
        HttpResponse.json(
          { error: { code: "SERVER_ERROR", message: "Server error", details: {} } },
          { status: 500 }
        )
      ),
      http.get(apiUrl("/attendance/history"), () =>
        HttpResponse.json({
          sessions: {
            items: [],
            pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 }
          }
        })
      )
    );

    renderWithProviders(<EmployeeAttendancePage />);

    expect(await screen.findByText("تعذّر تحميل حالة الحضور.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل الحضور" })).toBeDisabled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("shows current state and records check-in with browser location", async () => {
    const getCurrentPosition = mockGeolocation();
    let receivedBody: unknown;
    server.use(
      http.get(apiUrl("/attendance/me"), () =>
        HttpResponse.json({
          attendance: {
            employeeId: 2,
            currentAction: "check_in",
            openSession: null,
            todaySessions: []
          }
        })
      ),
      http.get(apiUrl("/attendance/history"), () =>
        HttpResponse.json({
          sessions: {
            items: [completedSession],
            pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }
          }
        })
      ),
      http.post(apiUrl("/attendance/action"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          attendance: {
            employeeId: 2,
            currentAction: "check_out",
            openSession,
            todaySessions: [openSession]
          }
        });
      })
    );

    renderWithProviders(<EmployeeAttendancePage />);

    expect(await screen.findByText("جاهز لتسجيل الحضور")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "تسجيل الحضور" }));

    await waitFor(() =>
      expect(receivedBody).toMatchObject({
        action: "check_in",
        latitude: 30.04442,
        longitude: 31.235712
      })
    );
    expect(getCurrentPosition).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText("جلسة مفتوحة").length).toBeGreaterThan(0));
  });

  it("maps attendance validation failures into Arabic guidance", async () => {
    mockGeolocation(29, 31);
    server.use(
      http.get(apiUrl("/attendance/me"), () =>
        HttpResponse.json({
          attendance: {
            employeeId: 2,
            currentAction: "check_in",
            openSession: null,
            todaySessions: []
          }
        })
      ),
      http.get(apiUrl("/attendance/history"), () =>
        HttpResponse.json({
          sessions: {
            items: [],
            pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 }
          }
        })
      ),
      http.post(apiUrl("/attendance/action"), () =>
        HttpResponse.json(
          {
            error: {
              code: "ATTENDANCE_VALIDATION_FAILED",
              message: "Attendance validation failed",
              details: {
                failureReasons: ["device_not_allowed", "gps_out_of_range", "ip_not_allowed"]
              }
            },
            attendance: {
              employeeId: 2,
              currentAction: "check_in",
              openSession: null,
              todaySessions: []
            }
          },
          { status: 422 }
        )
      )
    );

    renderWithProviders(<EmployeeAttendancePage />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "تسجيل الحضور" }));

    expect(await screen.findByText("هذا الجهاز غير مسموح لتسجيل الحضور.")).toBeInTheDocument();
    expect(screen.getByText("الموقع الحالي خارج نطاق الفرع.")).toBeInTheDocument();
    expect(screen.getByText("الشبكة الحالية غير مسموحة لهذا الفرع.")).toBeInTheDocument();
  });

  it("surfaces server failures when recording attendance", async () => {
    mockGeolocation();
    server.use(
      http.get(apiUrl("/attendance/me"), () =>
        HttpResponse.json({
          attendance: {
            employeeId: 2,
            currentAction: "check_in",
            openSession: null,
            todaySessions: []
          }
        })
      ),
      http.get(apiUrl("/attendance/history"), () =>
        HttpResponse.json({
          sessions: {
            items: [],
            pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 }
          }
        })
      ),
      http.post(apiUrl("/attendance/action"), () =>
        HttpResponse.json(
          { error: { code: "SERVER_ERROR", message: "Server error", details: {} } },
          { status: 500 }
        )
      )
    );

    renderWithProviders(<EmployeeAttendancePage />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "تسجيل الحضور" }));

    expect(await screen.findByText("تعذّر تسجيل الحركة. حاول مرة أخرى.")).toBeInTheDocument();
  });
});

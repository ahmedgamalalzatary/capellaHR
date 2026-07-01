import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { attendanceApi } from "@/features/attendance/attendance.api";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const session = {
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

describe("attendanceApi", () => {
  it("loads the current employee attendance state", async () => {
    server.use(
      http.get(apiUrl("/attendance/me"), () =>
        HttpResponse.json({
          attendance: {
            employeeId: 2,
            currentAction: "check_out",
            openSession: session,
            todaySessions: [session]
          }
        })
      )
    );

    const result = await attendanceApi.getCurrent();

    expect(result.attendance.currentAction).toBe("check_out");
    expect(result.attendance.todaySessions).toHaveLength(1);
  });

  it("loads paginated employee attendance history", async () => {
    let receivedUrl: URL | undefined;
    server.use(
      http.get(apiUrl("/attendance/history"), ({ request }) => {
        receivedUrl = new URL(request.url);
        return HttpResponse.json({
          sessions: {
            items: [session],
            pagination: { page: 2, pageSize: 5, total: 6, totalPages: 2 }
          }
        });
      })
    );

    const result = await attendanceApi.listHistory({ page: 2, pageSize: 5 });

    expect(receivedUrl?.searchParams.get("page")).toBe("2");
    expect(receivedUrl?.searchParams.get("pageSize")).toBe("5");
    expect(result.sessions.pagination.totalPages).toBe(2);
  });

  it("posts an attendance action with GPS coordinates and device id", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(apiUrl("/attendance/action"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          attendance: {
            employeeId: 2,
            currentAction: "check_out",
            openSession: session,
            todaySessions: [session]
          }
        });
      })
    );

    const result = await attendanceApi.recordAction({
      action: "check_in",
      latitude: 30.04442,
      longitude: 31.235712,
      deviceId: "browser-device"
    });

    expect(receivedBody).toEqual({
      action: "check_in",
      latitude: 30.04442,
      longitude: 31.235712,
      deviceId: "browser-device"
    });
    expect(result.attendance.currentAction).toBe("check_out");
  });
});

import { describe, expect, it } from "vitest";
import { createAttendanceService } from "../../../../src/modules/attendance/service";
import {
  assertAttendanceState,
  assertBlockedAttemptResult,
  createBaseRepository,
  validAction
} from "./attendance-service.fixtures";

describe("attendance service (employee actions)", () => {
  it("creates an open attendance session when check-in passes device, gps, and ip validation", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });

    const result = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    assertAttendanceState(result);
    expect(result.currentAction).toBe("check_out");
    expect(result.openSession?.status).toBe("open");
    expect(result.todaySessions).toHaveLength(1);
  });

  it("stores a blocked attempt when attendance validation fails", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });

    const result = await service.recordEmployeeAction(1, {
      action: "check_in",
      latitude: 29.0,
      longitude: 31.0,
      deviceId: "unknown-device"
    }, {
      ipAddress: "10.0.0.10",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    assertBlockedAttemptResult(result);
    expect(result.blockedAttempt.failureReasons).toEqual([
      "device_not_allowed",
      "gps_out_of_range",
      "ip_not_allowed"
    ]);
    expect(repository.blockedAttempts).toHaveLength(1);
    expect(result.currentAction).toBe("check_in");
  });

  it("completes the open attendance session on check-out within the same Cairo day", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });
    const checkIn = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });
    assertAttendanceState(checkIn);

    const checkOut = await service.recordEmployeeAction(1, validAction("check_out"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T12:00:00.000Z")
    });

    assertAttendanceState(checkOut);
    expect(checkOut.currentAction).toBe("check_in");
    expect(checkOut.openSession).toBeNull();
    expect(checkOut.todaySessions[0]?.status).toBe("completed");
    expect(checkOut.todaySessions[0]?.checkOutAtUtc).toEqual(new Date("2026-06-22T12:00:00.000Z"));
  });

  it("rejects a second check-in while a session is still open", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });
    await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    const result = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T07:00:00.000Z")
    });

    expect(result).toEqual({
      error: {
        code: "ATTENDANCE_ACTION_OUT_OF_ORDER",
        message: "Employee already has an open attendance session",
        details: {}
      }
    });
  });

  it("blocks attendance on a weekly day off", async () => {
    const repository = createBaseRepository();
    repository.weeklyDayOffDates.add("1:2026-06-22");
    const service = createAttendanceService({ repository });

    const result = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    assertBlockedAttemptResult(result);
    expect(result.blockedAttempt.failureReasons).toEqual(["weekly_day_off"]);
  });
});

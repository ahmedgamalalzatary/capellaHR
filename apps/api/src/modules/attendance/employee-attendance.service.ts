import type { AttendanceActionInput } from "@capella/shared";
import { type AttendanceErrorResult, createActionOutOfOrderError } from "./attendance-errors";
import {
  type AttendanceBlockedResult,
  type AttendanceRepository,
  type AttendanceState,
  buildAttendanceState,
  createBranchPolicySnapshot,
  getCairoDateKey
} from "./attendance-utils";
import { loadAttendanceContext, validateAttendanceAction } from "./attendance-validation";

export function createEmployeeAttendanceService(repository: AttendanceRepository) {
  return {
    async getEmployeeAttendance(employeeId: number, now = new Date()) {
      const context = await loadAttendanceContext(repository, employeeId, now);

      if ("error" in context) {
        return context;
      }

      return buildAttendanceState(
        employeeId,
        context.sessions,
        context.openSession,
        context.now
      );
    },

    async recordEmployeeAction(
      employeeId: number,
      input: AttendanceActionInput,
      runtime: {
        ipAddress: string;
        occurredAtUtc?: Date;
      }
    ): Promise<AttendanceState | AttendanceBlockedResult | AttendanceErrorResult> {
      const now = runtime.occurredAtUtc ?? new Date();
      const context = await loadAttendanceContext(repository, employeeId, now);

      if ("error" in context) {
        return context;
      }

      if (input.action === "check_in" && context.openSession) {
        return createActionOutOfOrderError("Employee already has an open attendance session");
      }

      if (input.action === "check_out" && !context.openSession) {
        return createActionOutOfOrderError("Employee does not have an open attendance session");
      }

      if (
        input.action === "check_out" &&
        context.openSession &&
        getCairoDateKey(context.openSession.checkInAtUtc) !== getCairoDateKey(now)
      ) {
        return {
          error: {
            code: "OVERNIGHT_ATTENDANCE_NOT_ALLOWED",
            message: "Attendance check-out must happen on the same Cairo date",
            details: {}
          }
        };
      }

      const validation = await validateAttendanceAction({
        repository,
        employeeId,
        input,
        ipAddress: runtime.ipAddress,
        now,
        branch: context.branch,
        activeDeviceFingerprint: context.activeDeviceFingerprint,
        branchPolicySnapshot: input.action === "check_out" && context.openSession
          ? context.openSession.branchPolicySnapshot
          : createBranchPolicySnapshot(context.branch)
      });

      if (validation.failureReasons.length > 0) {
        const blockedAttempt = await repository.createBlockedAttempt({
          employeeId,
          branchId: context.branch.id,
          attemptedAction: input.action,
          failureReasons: validation.failureReasons,
          latitude: input.latitude,
          longitude: input.longitude,
          ipAddress: runtime.ipAddress,
          deviceId: input.deviceId,
          branchPolicySnapshot: validation.branchPolicySnapshot,
          occurredAtUtc: now
        });

        return {
          ...buildAttendanceState(employeeId, context.sessions, context.openSession, now),
          blockedAttempt
        };
      }

      if (input.action === "check_in") {
        const session = await repository.createSession({
          employeeId,
          branchId: context.branch.id,
          checkInAtUtc: now,
          checkInLatitude: input.latitude,
          checkInLongitude: input.longitude,
          checkInIpAddress: runtime.ipAddress,
          deviceId: input.deviceId,
          branchPolicySnapshot: validation.branchPolicySnapshot
        });

        return buildAttendanceState(
          employeeId,
          [...context.sessions, session],
          session,
          now
        );
      }

      const completedSession = await repository.completeSession(
        context.openSession!.id,
        now
      );

      if (!completedSession) {
        return createActionOutOfOrderError("Employee does not have an open attendance session");
      }

      const completedSessions = context.sessions.map((session) =>
        session.id === completedSession.id ? completedSession : session
      );

      return buildAttendanceState(employeeId, completedSessions, null, now);
    }
  };
}

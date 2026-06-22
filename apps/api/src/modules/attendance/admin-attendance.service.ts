import type { AdminAttendanceCreateInput, AdminAttendanceUpdateInput, AttendanceListFilterInput } from "@capella/shared";
import {
  type AttendanceErrorResult,
  createAttendanceNotFoundError,
  createEmployeeNotFoundError,
  createMonthLockedError
} from "./attendance-errors";
import { type AttendanceRepository, getCairoDateKey } from "./attendance-utils";
import { validateAdminAttendanceMutation } from "./attendance-validation";

export function createAdminAttendanceService(repository: AttendanceRepository) {
  return {
    async listAdminAttendance(filters: AttendanceListFilterInput) {
      return repository.listAdminAttendance(filters);
    },

    async createAdminAttendance(input: AdminAttendanceCreateInput, adminId: number) {
      const employee = await repository.findEmployeeById(input.employeeId);

      if (!employee || employee.softDeletedAt !== null) {
        return createEmployeeNotFoundError();
      }

      const validation = await validateAdminAttendanceMutation(
        repository,
        employee.id,
        new Date(input.checkInAt),
        input.checkOutAt ? new Date(input.checkOutAt) : null
      );

      if (validation) {
        return validation;
      }

      return repository.createAdminAttendance({
        employeeId: input.employeeId,
        branchId: input.branchId,
        checkInAtUtc: new Date(input.checkInAt),
        checkOutAtUtc: input.checkOutAt ? new Date(input.checkOutAt) : null,
        reason: input.reason,
        adminId
      });
    },

    async updateAdminAttendance(sessionId: number, input: AdminAttendanceUpdateInput, adminId: number) {
      const existing = await repository.findAdminAttendanceById(sessionId);

      if (!existing) {
        return createAttendanceNotFoundError();
      }

      const validation = await validateAdminAttendanceMutation(
        repository,
        existing.employeeId,
        new Date(input.checkInAt),
        input.checkOutAt ? new Date(input.checkOutAt) : null
      );

      if (validation) {
        return validation;
      }

      return (await repository.updateAdminAttendance(sessionId, {
        branchId: input.branchId,
        checkInAtUtc: new Date(input.checkInAt),
        checkOutAtUtc: input.checkOutAt ? new Date(input.checkOutAt) : null,
        reason: input.reason,
        adminId
      })) ?? createAttendanceNotFoundError();
    },

    async deleteAdminAttendance(sessionId: number, reason: string, adminId: number): Promise<null | AttendanceErrorResult> {
      void reason;
      void adminId;
      const existing = await repository.findAdminAttendanceById(sessionId);

      if (!existing) {
        return createAttendanceNotFoundError();
      }

      if (await repository.isMonthLocked(getCairoDateKey(existing.checkInAtUtc).slice(0, 7))) {
        return createMonthLockedError();
      }

      await repository.deleteAdminAttendance(sessionId);
      return null;
    }
  };
}

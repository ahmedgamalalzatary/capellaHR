import type { AdminAttendanceCreateInput, AdminAttendanceUpdateInput, AttendanceListFilterInput } from "@capella/shared";
import {
  type AttendanceErrorResult,
  createAttendanceNotFoundError,
  createEmployeeNotFoundError,
  createMonthLockedError
} from "./attendance-errors";
import { type AttendanceRepository, getCairoDateKey } from "./attendance-utils";
import { validateAdminAttendanceMutation } from "./attendance-validation";
import type { createAuditLogService } from "../audit-logs/service";

export function createAdminAttendanceService(
  repository: AttendanceRepository,
  auditLogService?: ReturnType<typeof createAuditLogService>
) {
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

      const created = await repository.createAdminAttendance({
        employeeId: input.employeeId,
        branchId: input.branchId,
        checkInAtUtc: new Date(input.checkInAt),
        checkOutAtUtc: input.checkOutAt ? new Date(input.checkOutAt) : null,
        reason: input.reason,
        adminId
      });

      await auditLogService?.recordAuditLog({
        adminId,
        actionType: "create",
        entityType: "attendance",
        entityId: String(created.id),
        entityDisplayName: created.employeeName,
        reason: input.reason,
        before: null,
        after: toAttendanceAuditPayload(created)
      });

      return created;
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

      const updated = await repository.updateAdminAttendance(sessionId, {
        branchId: input.branchId,
        checkInAtUtc: new Date(input.checkInAt),
        checkOutAtUtc: input.checkOutAt ? new Date(input.checkOutAt) : null,
        reason: input.reason,
        adminId
      });

      if (!updated) {
        return createAttendanceNotFoundError();
      }

      await auditLogService?.recordAuditLog({
        adminId,
        actionType: "update",
        entityType: "attendance",
        entityId: String(updated.id),
        entityDisplayName: updated.employeeName,
        reason: input.reason,
        before: toAttendanceAuditPayload(existing),
        after: toAttendanceAuditPayload(updated)
      });

      return updated;
    },

    async deleteAdminAttendance(sessionId: number, reason: string, adminId: number): Promise<null | AttendanceErrorResult> {
      const existing = await repository.findAdminAttendanceById(sessionId);

      if (!existing) {
        return createAttendanceNotFoundError();
      }

      if (await repository.isMonthLocked(getCairoDateKey(existing.checkInAtUtc).slice(0, 7))) {
        return createMonthLockedError();
      }

      await repository.deleteAdminAttendance(sessionId);

      await auditLogService?.recordAuditLog({
        adminId,
        actionType: "delete",
        entityType: "attendance",
        entityId: String(existing.id),
        entityDisplayName: existing.employeeName,
        reason,
        before: toAttendanceAuditPayload(existing),
        after: null
      });

      return null;
    }
  };
}

function toAttendanceAuditPayload(record: {
  id: number;
  employeeId: number;
  employeeName: string;
  branchId: number;
  status: string;
  checkInAtUtc: Date;
  checkOutAtUtc: Date | null;
  adminReason: string | null;
  createdByAdminId: number | null;
  updatedByAdminId: number | null;
}) {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    branchId: record.branchId,
    status: record.status,
    checkInAtUtc: record.checkInAtUtc.toISOString(),
    checkOutAtUtc: record.checkOutAtUtc?.toISOString() ?? null,
    adminReason: record.adminReason,
    createdByAdminId: record.createdByAdminId,
    updatedByAdminId: record.updatedByAdminId
  };
}

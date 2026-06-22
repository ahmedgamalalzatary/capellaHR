import type { EmployeeBranchAssignmentCreateInput } from "@capella/shared";
import type { createAuditLogService } from "../audit-logs/service";
import { createBranchNotAssignableError, createEmployeeNotFoundError } from "./employee-errors";
import type { EmployeeRepository } from "./service";

type EmployeeBranchAssignmentErrorResult = {
  error: {
    code: "EMPLOYEE_NOT_FOUND" | "BRANCH_NOT_ASSIGNABLE" | "EMPLOYEE_BRANCH_ASSIGNMENT_PAST_DATE";
    message: string;
    details: Record<string, unknown>;
  };
};

export function createEmployeeBranchAssignmentService(
  repository: EmployeeRepository,
  auditLogService?: ReturnType<typeof createAuditLogService>
) {
  return {
    async listEmployeeBranchAssignments(employeeId: number) {
      const employee = await repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      return repository.listEmployeeBranchAssignments(employeeId);
    },

    async assignEmployeeBranch(
      employeeId: number,
      input: EmployeeBranchAssignmentCreateInput,
      assignedByAdminId: number,
      now = new Date()
    ) {
      const employee = await repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      const branchSetupStatus = await repository.findBranchSetupStatus(input.branchId);

      if (branchSetupStatus !== "completed") {
        return createBranchNotAssignableError();
      }

      const effectiveFrom = new Date(input.effectiveFrom);

      if (effectiveFrom.getTime() < now.getTime()) {
        return {
          error: {
            code: "EMPLOYEE_BRANCH_ASSIGNMENT_PAST_DATE",
            message: "Branch assignments can only be effective now or in the future",
            details: {}
          }
        } satisfies EmployeeBranchAssignmentErrorResult;
      }

      const openSession = await repository.findOpenAttendanceSession(employeeId);
      const assignment = await repository.createBranchAssignment({
        employeeId,
        branchId: input.branchId,
        effectiveFrom,
        assignedByAdminId,
        applyImmediately: !openSession && effectiveFrom.getTime() <= now.getTime()
      });

      await auditLogService?.recordAuditLog({
        adminId: assignedByAdminId,
        actionType: "create",
        entityType: "employee_branch_assignment",
        entityId: String(assignment.id),
        entityDisplayName: employee.fullName,
        before: null,
        after: assignment as unknown as Record<string, unknown>
      });

      return assignment;
    }
  };
}

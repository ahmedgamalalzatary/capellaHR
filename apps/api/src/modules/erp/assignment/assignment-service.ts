import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity, ErpAttendanceCapability } from '../hr-capabilities.js';

/**
 * The only employee identity the ERP ever sees: enough to show and record who
 * served the client, and nothing of the attendance session behind it.
 */
export type AssignableEmployee = {
  id: number;
  employeeCode: number;
  fullName: string;
  branchId: number;
};

export class ErpAssignmentError extends Error {
  constructor(
    public readonly code: 'ERP_EMPLOYEE_NOT_PRESENT',
    message: string,
  ) {
    super(message);
    this.name = 'ErpAssignmentError';
  }
}

const NOT_PRESENT_MESSAGE = 'الموظف غير مسجل حضورًا في الفرع الآن';

/**
 * Publishes who may be assigned to an invoice, and re-checks that answer when
 * the sale is completed.
 *
 * `docs/erp-plan.md` §7 locks assignment eligibility to strictly checked-in
 * employees with no Cashier or Admin override, so both roles run the identical
 * check and there is no bypass parameter anywhere in this surface.
 */
export const createEmployeeAssignmentService = (dependencies: {
  attendance: ErpAttendanceCapability;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const { attendance, resolveBranchContext } = dependencies;

  return {
    async listAssignable(
      actor: ErpAccountIdentity,
      query: { branchId?: number | undefined },
    ): Promise<AssignableEmployee[]> {
      const { branchId } = await resolveBranchContext(actor, query.branchId);
      return attendance.listPresentEmployees(branchId);
    },

    /**
     * Revalidation used when a sale is completed. `context` is the caller's
     * database transaction, so ERP 8's invoice write and this check settle on
     * one state: an employee who checked out after being selected is rejected.
     */
    async assertAssignable(
      actor: ErpAccountIdentity,
      input: { employeeId: number; branchId?: number | undefined },
      context?: unknown,
    ): Promise<AssignableEmployee> {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      const employee = await attendance.findPresentEmployee(branchId, input.employeeId, context);
      if (!employee) throw new ErpAssignmentError('ERP_EMPLOYEE_NOT_PRESENT', NOT_PRESENT_MESSAGE);
      return employee;
    },
  };
};

export type EmployeeAssignmentService = ReturnType<typeof createEmployeeAssignmentService>;

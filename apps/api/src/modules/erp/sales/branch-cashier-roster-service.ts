import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

/** The employees allowed to sell under a branch's shared cashier login. */
export type BranchCashierRosterMember = {
  id: number;
  employeeCode: number;
  fullName: string;
};

export interface BranchCashierRosterRepository {
  listByBranch(branchId: number): Promise<BranchCashierRosterMember[]>;
  replace(input: {
    branchId: number;
    employeeIds: number[];
    replacedAt: Date;
  }): Promise<
    | { kind: 'replaced'; members: BranchCashierRosterMember[] }
    | { kind: 'employee_not_in_branch' }
  >;
}

export type BranchCashierRosterErrorCode =
  | 'ERP_ROSTER_ADMIN_REQUIRED'
  | 'ERP_ROSTER_EMPLOYEE_INVALID';

export class BranchCashierRosterError extends Error {
  constructor(
    public readonly code: BranchCashierRosterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BranchCashierRosterError';
  }
}

export const createBranchCashierRosterService = (dependencies: {
  repository: BranchCashierRosterRepository;
  resolveBranchContext: ErpBranchContextResolver;
  now?: () => Date;
}) => {
  const now = dependencies.now ?? (() => new Date());

  return {
    async list(actor: ErpAccountIdentity, query: { branchId?: number | undefined }) {
      const { branchId } = await dependencies.resolveBranchContext(actor, query.branchId);
      return dependencies.repository.listByBranch(branchId);
    },

    async replace(
      actor: ErpAccountIdentity,
      query: { branchId?: number | undefined },
      input: { employeeIds: number[] },
    ) {
      if (actor.role !== 'admin') {
        throw new BranchCashierRosterError(
          'ERP_ROSTER_ADMIN_REQUIRED',
          'تعديل وردية الفرع متاح للمسؤول فقط',
        );
      }
      const { branchId } = await dependencies.resolveBranchContext(actor, query.branchId);
      const result = await dependencies.repository.replace({
        branchId,
        employeeIds: input.employeeIds,
        replacedAt: now(),
      });
      if (result.kind === 'employee_not_in_branch') {
        throw new BranchCashierRosterError(
          'ERP_ROSTER_EMPLOYEE_INVALID',
          'أحد الموظفين غير نشط أو لا ينتمي إلى هذا الفرع',
        );
      }
      return result.members;
    },
  };
};

export type BranchCashierRosterService = ReturnType<typeof createBranchCashierRosterService>;

import type {
  ErpAccountIdentity,
  ErpBranchCapability,
  ErpEmployeeCapability,
} from './hr-capabilities.js';

export type ErpBranchContext = {
  accountId: number;
  accountRole: 'admin' | 'cashier';
  branchId: number;
  employeeId: number | null;
};

type ErpBranchContextErrorCode =
  | 'ERP_BRANCH_REQUIRED'
  | 'ERP_BRANCH_NOT_FOUND'
  | 'ERP_CASHIER_EMPLOYEE_UNAVAILABLE'
  | 'ERP_BRANCH_FORBIDDEN';

export class ErpBranchContextError extends Error {
  constructor(
    public readonly code: ErpBranchContextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ErpBranchContextError';
  }
}

export const createErpBranchContextResolver = (capabilities: {
  branches: ErpBranchCapability;
  employees: ErpEmployeeCapability;
}) => async (
  actor: ErpAccountIdentity,
  requestedBranchId?: number,
): Promise<ErpBranchContext> => {
  if (actor.role === 'admin') {
    if (requestedBranchId === undefined) {
      throw new ErpBranchContextError('ERP_BRANCH_REQUIRED', 'Branch is required');
    }
    if (!await capabilities.branches.findById(requestedBranchId)) {
      throw new ErpBranchContextError('ERP_BRANCH_NOT_FOUND', 'Branch was not found');
    }
    return {
      accountId: actor.accountId,
      accountRole: actor.role,
      branchId: requestedBranchId,
      employeeId: null,
    };
  }

  const employee = await capabilities.employees.findActiveById(actor.employeeId);
  if (!employee) {
    throw new ErpBranchContextError(
      'ERP_CASHIER_EMPLOYEE_UNAVAILABLE',
      'Cashier employee is unavailable',
    );
  }
  if (requestedBranchId !== undefined && requestedBranchId !== employee.branchId) {
    throw new ErpBranchContextError(
      'ERP_BRANCH_FORBIDDEN',
      'Cashier cannot operate another branch',
    );
  }
  return {
    accountId: actor.accountId,
    accountRole: actor.role,
    branchId: employee.branchId,
    employeeId: employee.id,
  };
};

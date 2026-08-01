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

export type ErpBranchContextResolver = (
  actor: ErpAccountIdentity,
  requestedBranchId?: number,
) => Promise<ErpBranchContext>;

export const createErpBranchContextResolver = (capabilities: {
  branches: ErpBranchCapability;
  employees: ErpEmployeeCapability;
}) => async (
  actor: ErpAccountIdentity,
  requestedBranchId?: number,
): Promise<ErpBranchContext> => {
  if (actor.role === 'admin') {
    if (requestedBranchId === undefined) {
      throw new ErpBranchContextError('ERP_BRANCH_REQUIRED', 'يجب اختيار الفرع');
    }
    if (!await capabilities.branches.findById(requestedBranchId)) {
      throw new ErpBranchContextError('ERP_BRANCH_NOT_FOUND', 'الفرع غير موجود');
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
      'الموظف المرتبط بحساب الكاشير غير متاح',
    );
  }
  if (requestedBranchId !== undefined && requestedBranchId !== employee.branchId) {
    throw new ErpBranchContextError(
      'ERP_BRANCH_FORBIDDEN',
      'لا يمكن للكاشير تنفيذ عمليات على فرع آخر',
    );
  }
  return {
    accountId: actor.accountId,
    accountRole: actor.role,
    branchId: employee.branchId,
    employeeId: employee.id,
  };
};

import type {
  ErpAccountIdentity,
  ErpBranchCapability,
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

  // The branch login's identity already carries its branch; no HR lookup needed.
  if (typeof actor.branchId !== 'number') {
    throw new ErpBranchContextError(
      'ERP_CASHIER_EMPLOYEE_UNAVAILABLE',
      'حساب كاشير الفرع غير متاح',
    );
  }
  if (requestedBranchId !== undefined && requestedBranchId !== actor.branchId) {
    throw new ErpBranchContextError(
      'ERP_BRANCH_FORBIDDEN',
      'لا يمكن للكاشير تنفيذ عمليات على فرع آخر',
    );
  }
  return {
    accountId: actor.accountId,
    accountRole: actor.role,
    branchId: actor.branchId,
    employeeId: null,
  };
};

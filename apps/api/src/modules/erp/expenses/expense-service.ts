import type { CorrectExpenseInput, CreateExpenseInput, ListExpensesQuery } from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

export type ExpenseRecord = {
  id: number; branchId: number; categoryId: number; categoryName: string; amount: string;
  expenseDate: string; description: string; actingAccountId: number; actingUsername: string;
  kind: 'expense' | 'reversal'; status: 'active' | 'corrected'; reversalOfId: number | null;
  supersedesId: number | null; correctionReason: string | null; createdAt: Date;
};
export type ExpenseWrite = Omit<CreateExpenseInput, 'branchId'> & { branchId: number; actingAccountId: number };
export type ExpenseCorrectionWrite = Omit<CorrectExpenseInput, 'branchId' | 'reason'> & { branchId: number; actingAccountId: number; reason: string };
export type CorrectionResult = { original: ExpenseRecord; reversal: ExpenseRecord; replacement: ExpenseRecord };
export type ExpenseWriteOutcome = ExpenseRecord | 'invalid-category';
export type ExpenseCorrectionOutcome = CorrectionResult | 'invalid-category' | 'invalid-target' | 'already-corrected';

export interface ExpenseRepository {
  create(input: ExpenseWrite): Promise<ExpenseWriteOutcome>;
  findById(id: number): Promise<ExpenseRecord | null>;
  list(branchId: number, query: ListExpensesQuery): Promise<{ items: ExpenseRecord[]; total: number }>;
  correct(id: number, input: ExpenseCorrectionWrite): Promise<ExpenseCorrectionOutcome>;
}

export type ExpenseErrorCode = 'ERP_EXPENSE_ADMIN_REQUIRED' | 'EXPENSE_NOT_FOUND' | 'EXPENSE_CATEGORY_INVALID' | 'EXPENSE_ALREADY_CORRECTED' | 'EXPENSE_CORRECTION_TARGET_INVALID';
const messages: Record<ExpenseErrorCode, string> = {
  ERP_EXPENSE_ADMIN_REQUIRED: 'تصحيح المصروفات متاح للمدير فقط',
  EXPENSE_NOT_FOUND: 'المصروف غير موجود',
  EXPENSE_CATEGORY_INVALID: 'يجب اختيار تصنيف مصروفات نشط من نفس الفرع',
  EXPENSE_ALREADY_CORRECTED: 'تم تصحيح هذا المصروف من قبل',
  EXPENSE_CORRECTION_TARGET_INVALID: 'لا يمكن تصحيح قيد عكسي',
};
export class ExpenseError extends Error {
  constructor(public readonly code: ExpenseErrorCode) { super(messages[code]); this.name = 'ExpenseError'; }
}
const fail = (code: ExpenseErrorCode): never => { throw new ExpenseError(code); };

export const createExpenseService = ({ repository, resolveBranchContext }: {
  repository: ExpenseRepository; resolveBranchContext: ErpBranchContextResolver;
}) => {
  /**
   * A cashier records and reads the spending of the shift; the resolver pins the branch to
   * the account, so a requested branch id can never widen that scope. Correcting a posted
   * expense rewrites the ledger, so it stays with the admin.
   */
  const context = (actor: ErpAccountIdentity, branchId?: number) => resolveBranchContext(actor, branchId);
  const adminContext = async (actor: ErpAccountIdentity, branchId?: number) => {
    if (actor.role !== 'admin') fail('ERP_EXPENSE_ADMIN_REQUIRED');
    return context(actor, branchId);
  };
  return {
    async create(actor: ErpAccountIdentity, input: CreateExpenseInput): Promise<ExpenseRecord> {
      const scope = await context(actor, input.branchId);
      const result = await repository.create({ ...input, branchId: scope.branchId, actingAccountId: scope.accountId });
      if (result === 'invalid-category') return fail('EXPENSE_CATEGORY_INVALID');
      return result;
    },
    async get(actor: ErpAccountIdentity, id: number, branchId?: number): Promise<ExpenseRecord> {
      const scope = await context(actor, branchId);
      const record = await repository.findById(id);
      if (!record || record.branchId !== scope.branchId) return fail('EXPENSE_NOT_FOUND');
      return record;
    },
    async list(actor: ErpAccountIdentity, query: ListExpensesQuery): Promise<{ items: ExpenseRecord[]; total: number }> {
      const scope = await context(actor, query.branchId);
      return repository.list(scope.branchId, query);
    },
    async correct(actor: ErpAccountIdentity, id: number, input: CorrectExpenseInput): Promise<CorrectionResult> {
      const scope = await adminContext(actor, input.branchId);
      const current = await repository.findById(id);
      if (!current || current.branchId !== scope.branchId) return fail('EXPENSE_NOT_FOUND');
      const result = await repository.correct(id, { ...input, branchId: scope.branchId, actingAccountId: scope.accountId, reason: input.reason });
      if (result === 'invalid-category') return fail('EXPENSE_CATEGORY_INVALID');
      if (result === 'already-corrected') return fail('EXPENSE_ALREADY_CORRECTED');
      if (result === 'invalid-target') return fail('EXPENSE_CORRECTION_TARGET_INVALID');
      return result;
    },
  };
};
export type ExpenseService = ReturnType<typeof createExpenseService>;

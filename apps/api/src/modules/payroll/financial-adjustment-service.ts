export type FinancialAdjustmentRecord = {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  payrollMonth: string;
  amount: string;
  reason?: string | null;
  employeeDeletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type AdjustmentMutationResult<T> =
  | { kind: 'success'; record: T }
  | { kind: 'not_found' | 'employee_not_found' | 'employee_deleted' | 'future_month' | 'ineligible_month' | 'finalized' };
type AdjustmentDeleteResult =
  | { kind: 'success' }
  | { kind: 'not_found' | 'employee_deleted' | 'finalized' };

export type AdjustmentRepository<Create, Update, Query, Record> = {
  create(input: Create): Promise<AdjustmentMutationResult<Record>>;
  findById(id: number): Promise<Record | null>;
  list(query: Query): Promise<{ items: Record[]; total: number }>;
  update(id: number, input: Update): Promise<AdjustmentMutationResult<Record>>;
  remove(id: number): Promise<AdjustmentDeleteResult>;
};

export const createAdjustmentService = <Create, Update, Query, Record>(
  repository: AdjustmentRepository<Create, Update, Query, Record>,
  prefix: 'BONUS' | 'DEDUCTION',
) => {
  const fail = (kind: Exclude<AdjustmentMutationResult<Record>['kind'], 'success'> | 'not_found') => {
    const suffix = ({
      not_found: 'NOT_FOUND', employee_not_found: 'EMPLOYEE_NOT_FOUND',
      employee_deleted: 'EMPLOYEE_DELETED', future_month: 'FUTURE_MONTH',
      ineligible_month: 'MONTH_NOT_ELIGIBLE', finalized: 'PAYROLL_FINALIZED',
    } as const)[kind];
    const code = `${prefix}_${suffix}`;
    throw new FinancialAdjustmentError(code, 'تعذر تنفيذ عملية الراتب');
  };
  return {
    async create(input: Create) {
      const result = await repository.create(input);
      if (result.kind === 'success') return result.record;
      return fail(result.kind);
    },
    async get(id: number) {
      const record = await repository.findById(id);
      if (!record) return fail('not_found');
      return record;
    },
    list(query: Query) { return repository.list(query); },
    async update(id: number, input: Update) {
      const result = await repository.update(id, input);
      if (result.kind === 'success') return result.record;
      return fail(result.kind);
    },
    async remove(id: number) {
      const result = await repository.remove(id);
      if (result.kind !== 'success') return fail(result.kind);
    },
  };
};

export class FinancialAdjustmentError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

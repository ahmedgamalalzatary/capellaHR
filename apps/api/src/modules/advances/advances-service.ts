import type { CreateAdvanceInput, ListAdvancesQuery, UpdateAdvanceInput } from '@capella/contracts';

export type AdvanceInstallmentRecord = { id: number; ordinal: number; payrollMonth: string; amount: string };
export type AdvanceRecord = {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  amount: string;
  installmentCount: number;
  startMonth: string;
  employeeDeletedAt: Date | null;
  installments: AdvanceInstallmentRecord[];
  createdAt: Date;
  updatedAt: Date;
};
type MutationResult =
  | { kind: 'success'; record: AdvanceRecord }
  | { kind: 'not_found' | 'employee_not_found' | 'employee_deleted' | 'ineligible_month' | 'finalized' | 'invalid_schedule' };
type DeleteResult = { kind: 'success' } | { kind: 'not_found' | 'employee_deleted' | 'finalized' };
export interface AdvanceRepository {
  create(input: CreateAdvanceInput): Promise<MutationResult>;
  findById(id: number): Promise<AdvanceRecord | null>;
  list(query: ListAdvancesQuery): Promise<{ items: AdvanceRecord[]; total: number }>;
  update(id: number, input: UpdateAdvanceInput): Promise<MutationResult>;
  remove(id: number): Promise<DeleteResult>;
  accelerateForDeletion(employeeId: number, deletedAt: Date, context: unknown): Promise<void>;
}
export type AdvanceErrorCode =
  | 'ADVANCE_NOT_FOUND' | 'ADVANCE_EMPLOYEE_NOT_FOUND' | 'ADVANCE_EMPLOYEE_DELETED'
  | 'ADVANCE_MONTH_NOT_ELIGIBLE' | 'ADVANCE_PAYROLL_FINALIZED' | 'ADVANCE_INVALID_SCHEDULE';
export class AdvanceError extends Error {
  constructor(public readonly code: AdvanceErrorCode, message = 'تعذر تنفيذ عملية السلفة') { super(message); }
}
const fail = (kind: Exclude<MutationResult['kind'], 'success'> | 'not_found'): never => {
  const code = ({
    not_found: 'ADVANCE_NOT_FOUND', employee_not_found: 'ADVANCE_EMPLOYEE_NOT_FOUND',
    employee_deleted: 'ADVANCE_EMPLOYEE_DELETED', ineligible_month: 'ADVANCE_MONTH_NOT_ELIGIBLE',
    finalized: 'ADVANCE_PAYROLL_FINALIZED', invalid_schedule: 'ADVANCE_INVALID_SCHEDULE',
  } as const)[kind];
  throw new AdvanceError(code);
};
export const createAdvanceService = (repository: AdvanceRepository) => ({
  async create(input: CreateAdvanceInput) { const result = await repository.create(input); return result.kind === 'success' ? result.record : fail(result.kind); },
  async get(id: number) { return await repository.findById(id) ?? fail('not_found'); },
  list(query: ListAdvancesQuery) { return repository.list(query); },
  async update(id: number, input: UpdateAdvanceInput) { const result = await repository.update(id, input); return result.kind === 'success' ? result.record : fail(result.kind); },
  async remove(id: number) { const result = await repository.remove(id); if (result.kind !== 'success') fail(result.kind); },
  accelerateForDeletion(employeeId: number, deletedAt: Date, context: unknown) {
    return repository.accelerateForDeletion(employeeId, deletedAt, context);
  },
});
export type AdvanceService = ReturnType<typeof createAdvanceService>;

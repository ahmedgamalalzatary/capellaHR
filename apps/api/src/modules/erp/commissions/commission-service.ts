import type {
  CommissionDetail,
  CommissionListQuery,
  CommissionPayout,
  CommissionPayoutCreate,
  CommissionSummary,
} from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

export type CreatePayoutInput = {
  branchId: number;
  accountId: number;
  employeeId: number;
  month: string;
  amount: string;
  reason?: string;
};

export type CreatePayoutResult =
  | { kind: 'success'; payout: CommissionPayout; summary: CommissionSummary }
  | { kind: 'employee_not_found' }
  | { kind: 'employee_deleted' }
  | { kind: 'finalized' }
  | { kind: 'insufficient_available' }
  | { kind: 'shift_not_open' };

export interface CommissionRepository {
  list(
    branchId: number,
    query: CommissionListQuery,
  ): Promise<{ items: CommissionSummary[]; total: number }>;
  detail(branchId: number, employeeId: number, month: string): Promise<CommissionDetail | null>;
  summary(employeeId: number, month: string): Promise<CommissionSummary | null>;
  createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult>;
}

export interface EmployeeCommissionCapability {
  getMonthlySummary(employeeId: number, month: string): Promise<CommissionSummary | null>;
}

export class CommissionError extends Error {
  constructor(public readonly code: (
    | 'COMMISSION_FORBIDDEN'
    | 'COMMISSION_NOT_FOUND'
    | 'COMMISSION_INSUFFICIENT_AVAILABLE'
    | 'COMMISSION_EMPLOYEE_NOT_FOUND'
    | 'COMMISSION_PAYROLL_FINALIZED'
    | 'COMMISSION_SHIFT_NOT_OPEN'
  )) {
    super(code);
    this.name = 'CommissionError';
  }
}

const payoutFailureCodes = {
  employee_not_found: 'COMMISSION_EMPLOYEE_NOT_FOUND',
  employee_deleted: 'COMMISSION_EMPLOYEE_NOT_FOUND',
  finalized: 'COMMISSION_PAYROLL_FINALIZED',
  insufficient_available: 'COMMISSION_INSUFFICIENT_AVAILABLE',
  shift_not_open: 'COMMISSION_SHIFT_NOT_OPEN',
} as const satisfies Partial<Record<Exclude<CreatePayoutResult, { kind: 'success' }>['kind'], CommissionError['code']>>;

export const createCommissionService = (dependencies: {
  repository: CommissionRepository;
  resolveBranchContext: ErpBranchContextResolver;
}) => ({
  async list(actor: ErpAccountIdentity, query: CommissionListQuery) {
    if (actor.role !== 'admin') throw new CommissionError('COMMISSION_FORBIDDEN');
    const { branchId } = await dependencies.resolveBranchContext(actor, query.branchId);
    return dependencies.repository.list(branchId, query);
  },

  async detail(
    actor: ErpAccountIdentity,
    employeeId: number,
    month: string,
    requestedBranchId?: number,
  ) {
    if (actor.role !== 'admin') throw new CommissionError('COMMISSION_FORBIDDEN');
    const { branchId } = await dependencies.resolveBranchContext(actor, requestedBranchId);
    const detail = await dependencies.repository.detail(branchId, employeeId, month);
    if (!detail) throw new CommissionError('COMMISSION_NOT_FOUND');
    return detail;
  },

  async createPayout(
    actor: ErpAccountIdentity,
    employeeId: number,
    month: string,
    input: CommissionPayoutCreate,
  ) {
    if (actor.role !== 'admin') throw new CommissionError('COMMISSION_FORBIDDEN');
    const { branchId, accountId } = await dependencies.resolveBranchContext(actor, input.branchId);
    const result = await dependencies.repository.createPayout({
      branchId,
      accountId,
      employeeId,
      month,
      amount: input.amount,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
    if (result.kind !== 'success') {
      throw new CommissionError(payoutFailureCodes[result.kind]);
    }
    return { payout: result.payout, summary: result.summary };
  },

  selfService: {
    getMonthlySummary(employeeId: number, month: string) {
      return dependencies.repository.summary(employeeId, month);
    },
  } satisfies EmployeeCommissionCapability,
});

export type CommissionService = ReturnType<typeof createCommissionService>;

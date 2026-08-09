import type {
  CommissionDetail,
  CommissionListQuery,
  CommissionSummary,
} from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

export interface CommissionRepository {
  list(
    branchId: number,
    query: CommissionListQuery,
  ): Promise<{ items: CommissionSummary[]; total: number }>;
  detail(branchId: number, employeeId: number, month: string): Promise<CommissionDetail | null>;
  summary(employeeId: number, month: string): Promise<CommissionSummary | null>;
}

export interface EmployeeCommissionCapability {
  getMonthlySummary(employeeId: number, month: string): Promise<CommissionSummary | null>;
}

export class CommissionError extends Error {
  constructor(public readonly code: 'COMMISSION_FORBIDDEN' | 'COMMISSION_NOT_FOUND') {
    super(code);
    this.name = 'CommissionError';
  }
}

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

  selfService: {
    getMonthlySummary(employeeId: number, month: string) {
      return dependencies.repository.summary(employeeId, month);
    },
  } satisfies EmployeeCommissionCapability,
});

export type CommissionService = ReturnType<typeof createCommissionService>;

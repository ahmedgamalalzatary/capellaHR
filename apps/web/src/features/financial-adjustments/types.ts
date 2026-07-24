/** Bonus and deduction records share a wire shape; only bonuses include a reason. */
export interface FinancialAdjustment {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  payrollMonth: string;
  amount: string;
  reason?: string | null;
  employeeDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAdjustmentsParams {
  search?: string;
  branchId?: number;
  employeeId?: number;
  payrollMonth?: string;
  page?: number;
  pageSize?: number;
}

interface CreateAdjustmentInput {
  employeeId: number;
  amount: string;
  payrollMonth: string;
  reason?: string;
}

interface UpdateAdjustmentInput {
  amount?: string;
  payrollMonth?: string;
  reason?: string;
}

export interface AdjustmentApi {
  list(params: ListAdjustmentsParams): Promise<{
    items: FinancialAdjustment[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>;
  create(input: CreateAdjustmentInput): Promise<FinancialAdjustment>;
  update(id: number, input: UpdateAdjustmentInput): Promise<FinancialAdjustment>;
  remove(id: number): Promise<void>;
}

export interface AdjustmentLabels {
  addLabel: string;
  formTitleCreate: string;
  formTitleEdit: string;
  emptyTitle: string;
  emptyDescription: string;
  loadErrorTitle: string;
  loadingText: string;
  totalNoun: string;
}

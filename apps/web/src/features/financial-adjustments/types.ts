/** Bonus and deduction records share one wire shape on the financial API. */
export interface FinancialAdjustment {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  payrollMonth: string;
  amount: string;
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

export interface CreateAdjustmentInput {
  employeeId: number;
  amount: string;
  payrollMonth: string;
}

export interface UpdateAdjustmentInput {
  amount?: string;
  payrollMonth?: string;
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

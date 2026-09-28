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
  /** Present only when the amount was priced from a day count rather than typed in. */
  days?: number | null;
  baseSalarySnapshot?: string | null;
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
  amount?: string;
  days?: number;
  payrollMonth: string;
  reason?: string;
}

interface UpdateAdjustmentInput {
  amount?: string;
  days?: number;
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

/** What the form holds: both prices as text, either of which may be left blank. */
export type AdjustmentPricedInput = {
  amount?: string | undefined;
  days?: string | undefined;
};

/**
 * Sends whichever price the user filled in, and only that one. The server prices a day
 * count itself, so the form never sends a money figure it derived on its own.
 */
export const pricedFields = ({ amount, days }: AdjustmentPricedInput) => {
  const typed = (amount ?? '').trim();
  const counted = (days ?? '').trim();
  if (counted !== '') return { days: Number(counted) };
  if (typed !== '') return { amount: typed };
  return {};
};

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

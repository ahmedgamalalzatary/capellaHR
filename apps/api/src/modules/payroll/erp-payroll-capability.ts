export type ErpPayrollCommissionInput = {
  employeeId: number;
  payrollMonth: string;
  amount: string;
  reference: string;
};

export type ErpPostPayrollDeductionInput = {
  employeeId: number;
  occurredAt: Date;
  amount: string;
  reference: string;
};

export interface ErpPayrollCapability {
  projectCommission(
    input: ErpPayrollCommissionInput,
  ): Promise<'recorded' | 'already_recorded' | 'payroll_finalized'>;
  recordPostPayrollDeduction(
    input: ErpPostPayrollDeductionInput,
  ): Promise<'recorded' | 'already_recorded'>;
}

import type { ListPayrollMonthsQuery, UpdateBaseSalaryInput } from '@capella/contracts';

export type BaseSalaryRecord = {
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  amount: string;
  deletedAt: Date | null;
};

export type PayrollRecord = {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  payrollMonth: string;
  status: 'open' | 'finalized';
  baseSalary: string;
  proratedBase: string;
  overtimeAmount: string;
  bonusAmount: string;
  attendanceDeductionAmount: string;
  manualDeductionAmount: string;
  advanceAmount: string;
  priorNegativeCarry: string;
  netSalary: string;
  eligibleWorkdays: number;
  fullMonthWorkdays: number;
  requiredMinutes: number;
  overtimeMinutes: number;
  shortageMinutes: number;
  finalizedAt: Date | null;
};

export type PayrollAttendanceFacts = {
  fullMonthWorkdays: number;
  eligibleWorkdays: number;
  requiredMinutes: number;
  overtimeMinutes: number;
  shortageMinutes: number;
};
export type PayrollTransactionContext = unknown;
export interface PayrollAttendanceGateway {
  readPayrollFacts(
    employeeId: number,
    payrollMonth: string,
    context: PayrollTransactionContext,
  ): Promise<{ kind: 'ready'; facts: PayrollAttendanceFacts } | { kind: 'blocked'; reasons: string[] }>;
}

type PayrollResult =
  | { kind: 'success'; payroll: PayrollRecord }
  | { kind: 'employee_not_found' | 'month_not_eligible' | 'month_not_ended' | 'already_finalized' | 'chronology_conflict' }
  | { kind: 'blocked'; reasons: string[] };
type PayrollListResult =
  | { kind: 'success'; items: PayrollRecord[]; total: number }
  | { kind: 'month_not_ended' }
  | { kind: 'blocked'; reasons: string[] };
type BranchPayrollResult =
  | { kind: 'success'; payrolls: PayrollRecord[] }
  | { kind: 'branch_not_found' | 'month_not_ended' | 'already_finalized' | 'chronology_conflict' }
  | { kind: 'blocked'; reasons: string[] };

export interface PayrollRepository {
  getBaseSalary(employeeId: number): Promise<BaseSalaryRecord | null>;
  updateBaseSalary(employeeId: number, amount: string): Promise<
    { kind: 'success'; salary: BaseSalaryRecord } | { kind: 'employee_not_found' | 'employee_deleted' }
  >;
  list(query: ListPayrollMonthsQuery, attendance: PayrollAttendanceGateway): Promise<PayrollListResult>;
  preview(employeeId: number, month: string, attendance: PayrollAttendanceGateway): Promise<PayrollResult>;
  finalize(employeeId: number, month: string, attendance: PayrollAttendanceGateway): Promise<PayrollResult>;
  finalizeBranch(branchId: number, month: string, attendance: PayrollAttendanceGateway): Promise<BranchPayrollResult>;
  isFinalized(employeeId: number, attendanceDate: string, context?: PayrollTransactionContext): Promise<boolean>;
}

export type PayrollErrorCode =
  | 'PAYROLL_EMPLOYEE_NOT_FOUND'
  | 'PAYROLL_EMPLOYEE_DELETED'
  | 'PAYROLL_ATTENDANCE_UNAVAILABLE'
  | 'PAYROLL_MONTH_NOT_ELIGIBLE'
  | 'PAYROLL_MONTH_NOT_ENDED'
  | 'PAYROLL_ALREADY_FINALIZED'
  | 'PAYROLL_CHRONOLOGY_CONFLICT'
  | 'PAYROLL_BLOCKED'
  | 'PAYROLL_BRANCH_NOT_FOUND';
export class PayrollError extends Error {
  constructor(public readonly code: PayrollErrorCode, message: string, public readonly reasons?: string[]) {
    super(message);
  }
}

const error = (code: PayrollErrorCode, reasons?: string[]) => new PayrollError(code, ({
  PAYROLL_EMPLOYEE_NOT_FOUND: 'الموظف غير موجود',
  PAYROLL_EMPLOYEE_DELETED: 'لا يمكن تعديل راتب موظف محذوف',
  PAYROLL_ATTENDANCE_UNAVAILABLE: 'تعذر التحقق من بيانات الحضور للراتب',
  PAYROLL_MONTH_NOT_ELIGIBLE: 'الموظف غير مستحق لراتب في هذا الشهر',
  PAYROLL_MONTH_NOT_ENDED: 'لا يمكن اعتماد الراتب قبل نهاية الشهر',
  PAYROLL_ALREADY_FINALIZED: 'تم اعتماد راتب هذا الشهر نهائيًا',
  PAYROLL_CHRONOLOGY_CONFLICT: 'يجب اعتماد الشهور الأقدم أولًا',
  PAYROLL_BLOCKED: 'تعذر اعتماد الراتب لوجود عوائق',
  PAYROLL_BRANCH_NOT_FOUND: 'الفرع غير موجود',
})[code], reasons);

const unwrap = (result: PayrollResult) => {
  if (result.kind === 'success') return result.payroll;
  if (result.kind === 'employee_not_found') throw error('PAYROLL_EMPLOYEE_NOT_FOUND');
  if (result.kind === 'month_not_eligible') throw error('PAYROLL_MONTH_NOT_ELIGIBLE');
  if (result.kind === 'month_not_ended') throw error('PAYROLL_MONTH_NOT_ENDED');
  if (result.kind === 'already_finalized') throw error('PAYROLL_ALREADY_FINALIZED');
  if (result.kind === 'chronology_conflict') throw error('PAYROLL_CHRONOLOGY_CONFLICT');
  if (result.kind === 'blocked') throw error('PAYROLL_BLOCKED', result.reasons);
  throw error('PAYROLL_BLOCKED');
};

export const createPayrollService = (
  repository: PayrollRepository,
  attendance?: PayrollAttendanceGateway,
) => {
  const requireAttendance = () => {
    if (!attendance) throw error('PAYROLL_ATTENDANCE_UNAVAILABLE');
    return attendance;
  };
  return {
    async getBaseSalary(employeeId: number) {
      const salary = await repository.getBaseSalary(employeeId);
      if (!salary) throw error('PAYROLL_EMPLOYEE_NOT_FOUND');
      return salary;
    },
    async updateBaseSalary(employeeId: number, input: UpdateBaseSalaryInput) {
      const result = await repository.updateBaseSalary(employeeId, input.amount);
      if (result.kind === 'success') return result.salary;
      throw error(result.kind === 'employee_deleted' ? 'PAYROLL_EMPLOYEE_DELETED' : 'PAYROLL_EMPLOYEE_NOT_FOUND');
    },
    async list(query: ListPayrollMonthsQuery) {
      const result = await repository.list(query, requireAttendance());
      if (result.kind === 'success') return { items: result.items, total: result.total };
      if (result.kind === 'month_not_ended') throw error('PAYROLL_MONTH_NOT_ENDED');
      throw error('PAYROLL_BLOCKED', result.reasons);
    },
    async preview(employeeId: number, month: string) {
      return unwrap(await repository.preview(employeeId, month, requireAttendance()));
    },
    async finalize(employeeId: number, month: string) {
      return unwrap(await repository.finalize(employeeId, month, requireAttendance()));
    },
    async finalizeBranch(branchId: number, month: string) {
      const result = await repository.finalizeBranch(branchId, month, requireAttendance());
      if (result.kind === 'success') return result.payrolls;
      if (result.kind === 'branch_not_found') throw error('PAYROLL_BRANCH_NOT_FOUND');
      if (result.kind === 'month_not_ended') throw error('PAYROLL_MONTH_NOT_ENDED');
      if (result.kind === 'already_finalized') throw error('PAYROLL_ALREADY_FINALIZED');
      if (result.kind === 'chronology_conflict') throw error('PAYROLL_CHRONOLOGY_CONFLICT');
      if (result.kind === 'blocked') throw error('PAYROLL_BLOCKED', result.reasons);
      throw error('PAYROLL_BLOCKED');
    },
    isFinanciallyLocked(employeeId: number, attendanceDate: string, context?: PayrollTransactionContext) {
      return repository.isFinalized(employeeId, attendanceDate, context);
    },
  };
};

export type PayrollService = ReturnType<typeof createPayrollService>;

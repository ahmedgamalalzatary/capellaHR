import type {
  SelfServiceAttendanceListQuery,
  SelfServiceFinancialListQuery,
  SelfServiceWeeklyDayListQuery,
} from '@capella/contracts';

import type { AdvanceRecord, AdvanceService } from '../advances/index.js';
import type { AttendanceService, AttendanceSession } from '../attendance/index.js';
import type { BonusRecord, BonusService } from '../bonuses/index.js';
import type { BranchService } from '../branches/index.js';
import type { DeductionService } from '../deductions/index.js';
import type { EmployeeService } from '../employees/index.js';
import type { PayrollRecord, PayrollService } from '../payroll/index.js';
import type { WeeklyDayOffService, WeeklyDayRecord } from '../weekly-day-off/index.js';

export type SelfServiceDependencies = {
  employees: Pick<EmployeeService, 'get'>;
  branches: Pick<BranchService, 'get'>;
  attendance: Pick<AttendanceService, 'listSessions'>;
  weeklyDays: Pick<WeeklyDayOffService, 'list'>;
  payroll: Pick<PayrollService, 'getBaseSalary' | 'preview'>;
  bonuses: Pick<BonusService, 'list'>;
  deductions: Pick<DeductionService, 'list'>;
  advances: Pick<AdvanceService, 'list'>;
};

const projectAttendance = (record: AttendanceSession) => ({
  id: record.id,
  attendanceDate: record.attendanceDate,
  state: record.checkOutAt === null ? 'open' as const : 'closed' as const,
  requiredMinutes: record.requiredMinutes,
  checkInAt: record.checkInAt,
  checkOutAt: record.checkOutAt,
  workedMinutes: record.workedMinutes,
  overtimeMinutes: record.overtimeMinutes,
  shortageMinutes: record.shortageMinutes,
});

const projectWeeklyDay = (record: WeeklyDayRecord) => ({
  id: record.id,
  attendanceDate: record.attendanceDate,
  status: record.status,
  requiredMinutes: record.requiredMinutes,
  dayOffConvertedAt: record.dayOffConvertedAt,
});

const projectAdjustment = (record: BonusRecord) => ({
  id: record.id,
  payrollMonth: record.payrollMonth,
  amount: record.amount,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const projectAdvance = (record: AdvanceRecord) => ({
  id: record.id,
  amount: record.amount,
  installmentCount: record.installmentCount,
  startMonth: record.startMonth,
  installments: record.installments.map((installment) => ({
    ordinal: installment.ordinal,
    payrollMonth: installment.payrollMonth,
    amount: installment.amount,
  })),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const projectPayroll = (record: PayrollRecord) => ({
  payrollMonth: record.payrollMonth,
  status: record.status,
  baseSalary: record.baseSalary,
  proratedBase: record.proratedBase,
  overtimeAmount: record.overtimeAmount,
  bonusAmount: record.bonusAmount,
  attendanceDeductionAmount: record.attendanceDeductionAmount,
  manualDeductionAmount: record.manualDeductionAmount,
  advanceAmount: record.advanceAmount,
  priorNegativeCarry: record.priorNegativeCarry,
  netSalary: record.netSalary,
  eligibleWorkdays: record.eligibleWorkdays,
  fullMonthWorkdays: record.fullMonthWorkdays,
  requiredMinutes: record.requiredMinutes,
  overtimeMinutes: record.overtimeMinutes,
  shortageMinutes: record.shortageMinutes,
  finalizedAt: record.finalizedAt,
});

const projectPage = <Source, Target>(
  result: { items: Source[]; total: number },
  project: (item: Source) => Target,
) => ({ items: result.items.map(project), total: result.total });

export const createSelfServiceService = (dependencies: SelfServiceDependencies) => ({
  async getOverview(employeeId: number) {
    const employee = await dependencies.employees.get(employeeId);
    const [branch, salary] = await Promise.all([
      dependencies.branches.get(employee.branchId),
      dependencies.payroll.getBaseSalary(employeeId),
    ]);

    return {
      profile: {
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        personalPhone: employee.personalPhone,
        whatsappPhone: employee.whatsappPhone,
        age: employee.age,
        address: employee.address,
      },
      branch: { name: branch.name, location: branch.location },
      shift: { durationMinutes: employee.shiftDurationMinutes },
      baseSalary: { amount: salary.amount, currency: 'EGP' as const },
    };
  },

  async listWeeklyDays(employeeId: number, query: SelfServiceWeeklyDayListQuery) {
    return projectPage(await dependencies.weeklyDays.list({ ...query, employeeId }), projectWeeklyDay);
  },

  async listAttendance(employeeId: number, query: SelfServiceAttendanceListQuery) {
    return projectPage(await dependencies.attendance.listSessions({ ...query, employeeId }), projectAttendance);
  },

  async getPayrollMonth(employeeId: number, month: string) {
    return projectPayroll(await dependencies.payroll.preview(employeeId, month));
  },

  async listBonuses(employeeId: number, query: SelfServiceFinancialListQuery) {
    return projectPage(await dependencies.bonuses.list({ ...query, employeeId }), projectAdjustment);
  },

  async listDeductions(employeeId: number, query: SelfServiceFinancialListQuery) {
    return projectPage(await dependencies.deductions.list({ ...query, employeeId }), projectAdjustment);
  },

  async listAdvances(employeeId: number, query: SelfServiceFinancialListQuery) {
    return projectPage(await dependencies.advances.list({ ...query, employeeId }), projectAdvance);
  },
});

export type SelfServiceService = ReturnType<typeof createSelfServiceService>;

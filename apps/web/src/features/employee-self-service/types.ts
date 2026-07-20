export type SelfServiceOverview = {
  profile: {
    employeeCode: number;
    fullName: string;
    personalPhone: string;
    whatsappPhone: string;
    age: number;
    address: string;
  };
  branch: { name: string; location: string };
  shift: { durationMinutes: number };
  baseSalary: { amount: string; currency: 'EGP' };
};

export type SelfServiceWeeklyDay = {
  id: number;
  attendanceDate: string;
  status: 'absence' | 'weekly_day_off';
  requiredMinutes: number;
  dayOffConvertedAt: string | null;
};

export type SelfServiceAdjustment = {
  id: number;
  payrollMonth: string;
  amount: string;
  createdAt: string;
  updatedAt: string;
};

export type SelfServiceAdvance = {
  id: number;
  amount: string;
  installmentCount: number;
  startMonth: string;
  installments: Array<{ ordinal: number; payrollMonth: string; amount: string }>;
  createdAt: string;
  updatedAt: string;
};

export type SelfServicePayroll = {
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
  finalizedAt: string | null;
};


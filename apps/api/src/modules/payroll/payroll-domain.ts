export type PayrollCalculationInput = {
  baseSalary: string;
  fullMonthWorkdays: number;
  eligibleWorkdays: number;
  requiredMinutes: number;
  overtimeMinutes: number;
  shortageMinutes: number;
  bonuses: string;
  deductions: string;
  advances: string;
  priorNegativeCarry: string;
};

const toCents = (amount: string) => {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};

const fromCents = (cents: bigint) => {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

const payrollSnapshotMaxCents = 99_999_999_999_999n;
export const isPayrollSnapshotAmount = (amount: string) => {
  const cents = toCents(amount);
  return cents >= -payrollSnapshotMaxCents && cents <= payrollSnapshotMaxCents;
};

const roundRatio = (numerator: bigint, denominator: bigint) => {
  if (denominator <= 0n) return 0n;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
};

export const calculatePayroll = (input: PayrollCalculationInput) => {
  const baseSalary = toCents(input.baseSalary);
  const hasAttendanceRate = input.fullMonthWorkdays > 0 && input.requiredMinutes > 0;
  const proratedNumerator = baseSalary * BigInt(input.eligibleWorkdays);
  const proratedDenominator = BigInt(input.fullMonthWorkdays);
  const proratedBase = !hasAttendanceRate
    ? 0n
    : roundRatio(proratedNumerator, proratedDenominator);
  const attendanceRateDenominator = proratedDenominator * BigInt(input.requiredMinutes);
  const overtimeAmount = !hasAttendanceRate
    ? 0n
    : roundRatio(proratedNumerator * BigInt(input.overtimeMinutes), attendanceRateDenominator);
  const attendanceDeductionAmount = !hasAttendanceRate
    ? 0n
    : roundRatio(proratedNumerator * BigInt(input.shortageMinutes), attendanceRateDenominator);
  const netSalary = proratedBase
    + overtimeAmount
    + toCents(input.bonuses)
    - attendanceDeductionAmount
    - toCents(input.deductions)
    - toCents(input.advances)
    + toCents(input.priorNegativeCarry);

  return {
    proratedBase: fromCents(proratedBase),
    overtimeAmount: fromCents(overtimeAmount),
    attendanceDeductionAmount: fromCents(attendanceDeductionAmount),
    netSalary: fromCents(netSalary),
  };
};

export const addPayrollMonths = (month: string, offset: number) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const absolute = year * 12 + monthNumber - 1 + offset;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = absolute % 12 + 1;
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}`;
};

export const isValidInstallmentSchedule = (amount: string, count: number, startMonth: string) => {
  if (!Number.isInteger(count) || count < 1 || count > 4) return false;
  const [year, monthNumber] = startMonth.split('-').map(Number) as [number, number];
  if (year < 1 || year > 9999 || monthNumber < 1 || monthNumber > 12) return false;
  if (toCents(amount) < BigInt(count)) return false;
  return year * 12 + monthNumber - 1 + count - 1 <= 9999 * 12 + 11;
};

export const splitInstallments = (amount: string, count: number, startMonth: string) => {
  if (!isValidInstallmentSchedule(amount, count, startMonth)) {
    throw new RangeError('Invalid advance installment schedule');
  }
  const total = toCents(amount);
  const installment = total / BigInt(count);
  const finalInstallment = total - installment * BigInt(count - 1);
  return Array.from({ length: count }, (_, index) => ({
    ordinal: index + 1,
    payrollMonth: addPayrollMonths(startMonth, index),
    amount: fromCents(index === count - 1 ? finalInstallment : installment),
  }));
};

export const payrollMonthStart = (month: string) => `${month}-01`;
export const calendarMonthInTimeZone = (instant: Date, timeZone = 'Africa/Cairo') => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}`;
};

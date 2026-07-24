import type {
  ListWeeklyDayRecordsQuery,
  WeeklyDayRecordStatus,
} from '@capella/contracts';

export type WeeklyDayRecord = {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  attendanceDate: string;
  status: WeeklyDayRecordStatus;
  absenceRequiredMinutes: number;
  requiredMinutes: number;
  dayOffConvertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type WeeklyDayOffTransactionContext = unknown;
export type WeeklyDayOffFinancialLockCheck = (
  employeeId: number,
  attendanceDate: string,
  context: WeeklyDayOffTransactionContext,
) => Promise<boolean>;

type ConvertResult =
  | { kind: 'success'; record: WeeklyDayRecord }
  | { kind: 'not_found' | 'not_past' | 'not_absence' | 'spacing_conflict' | 'financially_locked' };
type RevertResult =
  | { kind: 'success'; record: WeeklyDayRecord }
  | { kind: 'not_found' | 'not_day_off' | 'financially_locked' };

export interface WeeklyDayOffRepository {
  findById(id: number): Promise<WeeklyDayRecord | null>;
  list(query: ListWeeklyDayRecordsQuery): Promise<{ items: WeeklyDayRecord[]; total: number }>;
  convertToDayOff(
    id: number,
    today: string,
    isFinanciallyLocked: WeeklyDayOffFinancialLockCheck,
  ): Promise<ConvertResult>;
  revertToAbsence(
    id: number,
    isFinanciallyLocked: WeeklyDayOffFinancialLockCheck,
  ): Promise<RevertResult>;
}

export type WeeklyDayOffErrorCode =
  | 'WEEKLY_DAY_RECORD_NOT_FOUND'
  | 'WEEKLY_DAY_OFF_DATE_NOT_PAST'
  | 'WEEKLY_DAY_OFF_INVALID_STATE'
  | 'WEEKLY_DAY_OFF_SPACING_CONFLICT'
  | 'WEEKLY_DAY_OFF_FINANCIALLY_LOCKED';

export class WeeklyDayOffError extends Error {
  constructor(public readonly code: WeeklyDayOffErrorCode, message: string) {
    super(message);
  }
}

const errors = {
  notFound: () => new WeeklyDayOffError(
    'WEEKLY_DAY_RECORD_NOT_FOUND',
    'سجل الغياب أو يوم الراحة غير موجود',
  ),
  notPast: () => new WeeklyDayOffError(
    'WEEKLY_DAY_OFF_DATE_NOT_PAST',
    'يمكن تعيين يوم راحة لتاريخ سابق فقط',
  ),
  invalidState: () => new WeeklyDayOffError(
    'WEEKLY_DAY_OFF_INVALID_STATE',
    'حالة السجل لا تسمح بهذه العملية',
  ),
  spacingConflict: () => new WeeklyDayOffError(
    'WEEKLY_DAY_OFF_SPACING_CONFLICT',
    'يجب أن يفصل سبعة أيام على الأقل بين أيام الراحة',
  ),
  financiallyLocked: () => new WeeklyDayOffError(
    'WEEKLY_DAY_OFF_FINANCIALLY_LOCKED',
    'لا يمكن تعديل يوم الراحة بعد اعتماد الشهر ماليًا',
  ),
};

export const calendarDateInTimeZone = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value
  );
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const createWeeklyDayOffService = (
  repository: WeeklyDayOffRepository,
  options: {
    isFinanciallyLocked: WeeklyDayOffFinancialLockCheck;
    today?: () => string;
    timeZone?: string;
    now?: () => Date;
  },
) => {
  const today = options.today ?? (() => calendarDateInTimeZone(
    (options.now ?? (() => new Date()))(),
    options.timeZone ?? 'Africa/Cairo',
  ));
  const { isFinanciallyLocked } = options;

  return {
    async get(id: number) {
      const record = await repository.findById(id);
      if (!record) throw errors.notFound();
      return record;
    },

    list(query: ListWeeklyDayRecordsQuery) {
      return repository.list(query);
    },

    async convert(id: number) {
      const result = await repository.convertToDayOff(id, today(), isFinanciallyLocked);
      if (result.kind === 'success') return result.record;
      if (result.kind === 'not_found') throw errors.notFound();
      if (result.kind === 'not_past') throw errors.notPast();
      if (result.kind === 'not_absence') throw errors.invalidState();
      if (result.kind === 'spacing_conflict') throw errors.spacingConflict();
      throw errors.financiallyLocked();
    },

    async revert(id: number) {
      const result = await repository.revertToAbsence(id, isFinanciallyLocked);
      if (result.kind === 'success') return result.record;
      if (result.kind === 'not_found') throw errors.notFound();
      if (result.kind === 'not_day_off') throw errors.invalidState();
      throw errors.financiallyLocked();
    },
  };
};

export type WeeklyDayOffService = ReturnType<typeof createWeeklyDayOffService>;

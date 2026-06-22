import type { MonthLockCreateInput, MonthLockListFilterInput } from "@capella/shared";
import type { MonthLockRecord } from "./types";

type MonthLockErrorResult = {
  error: {
    code:
      | "MONTH_LOCK_ALREADY_EXISTS"
      | "MONTH_LOCK_HAS_OPEN_SESSIONS"
      | "MONTH_LOCK_NOT_ALLOWED";
    message: string;
    details: Record<string, unknown>;
  };
};

export type { MonthLockRecord } from "./types";

export type MonthLockRepository = {
  listMonthLocks(filters: MonthLockListFilterInput): Promise<MonthLockRecord[]>;
  findMonthLockByMonthKey(monthKey: string): Promise<MonthLockRecord | null>;
  hasOpenSessions(monthKey: string): Promise<boolean>;
  createMonthLock(input: {
    monthKey: string;
    lockedByAdminId: number;
    notes?: string;
  }): Promise<MonthLockRecord>;
};

type CreateMonthLockServiceOptions = {
  repository: MonthLockRepository;
  now?: () => Date;
};

export function createMonthLockService(options: CreateMonthLockServiceOptions) {
  return {
    async listMonthLocks(filters: MonthLockListFilterInput) {
      return options.repository.listMonthLocks(filters);
    },

    async createMonthLock(input: MonthLockCreateInput, lockedByAdminId: number) {
      const currentMonthKey = (options.now ?? (() => new Date()))().toISOString().slice(0, 7);

      if (input.monthKey >= currentMonthKey) {
        return createMonthLockNotAllowedError();
      }

      const existing = await options.repository.findMonthLockByMonthKey(input.monthKey);

      if (existing) {
        return createMonthLockAlreadyExistsError();
      }

      if (await options.repository.hasOpenSessions(input.monthKey)) {
        return createMonthLockHasOpenSessionsError();
      }

      return options.repository.createMonthLock({
        monthKey: input.monthKey,
        lockedByAdminId,
        notes: input.notes
      });
    }
  };
}

function createMonthLockAlreadyExistsError(): MonthLockErrorResult {
  return {
    error: {
      code: "MONTH_LOCK_ALREADY_EXISTS",
      message: "Month lock already exists",
      details: {}
    }
  };
}

function createMonthLockHasOpenSessionsError(): MonthLockErrorResult {
  return {
    error: {
      code: "MONTH_LOCK_HAS_OPEN_SESSIONS",
      message: "Open attendance sessions must be resolved before locking the month",
      details: {}
    }
  };
}

function createMonthLockNotAllowedError(): MonthLockErrorResult {
  return {
    error: {
      code: "MONTH_LOCK_NOT_ALLOWED",
      message: "Only completed past months can be locked",
      details: {}
    }
  };
}

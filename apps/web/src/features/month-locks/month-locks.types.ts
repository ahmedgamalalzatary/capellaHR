import type {
  MonthLockCreateInput,
  MonthLockListFilterInput
} from "@capella/shared/contracts";

export type MonthLockRecord = {
  id: number;
  monthKey: string;
  lockedAt: string;
  lockedByAdminId: number;
  notes: string | null;
};

export type MonthLocksResponse = {
  monthLocks: MonthLockRecord[];
};

export type MonthLockResponse = {
  monthLock: MonthLockRecord;
};

export type MonthLockFilters = MonthLockListFilterInput;
export type MonthLockCreatePayload = MonthLockCreateInput;

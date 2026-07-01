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
  monthLocks: {
    items: MonthLockRecord[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
};

export type MonthLockResponse = {
  monthLock: MonthLockRecord;
};

export type MonthLockFilters = MonthLockListFilterInput;
export type MonthLockCreatePayload = MonthLockCreateInput;

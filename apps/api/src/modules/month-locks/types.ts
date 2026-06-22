export type MonthLockRecord = {
  id: number;
  monthKey: string;
  lockedAt: string;
  lockedByAdminId: number;
  notes: string | null;
};

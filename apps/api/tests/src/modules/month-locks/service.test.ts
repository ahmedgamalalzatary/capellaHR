import { describe, expect, it } from "vitest";
import { createMonthLockService } from "../../../../src/modules/month-locks/service";
import type {
  MonthLockListFilterInput,
  MonthLockCreateInput
} from "@capella/shared";
import type {
  MonthLockRecord,
  MonthLockRepository
} from "../../../../src/modules/month-locks/service";

class InMemoryMonthLockRepository implements MonthLockRepository {
  locks: MonthLockRecord[] = [];
  openMonths = new Set<string>();
  nextId = 1;

  async listMonthLocks(filters: MonthLockListFilterInput) {
    const filtered = this.locks.filter((lock) => !filters.monthKey || lock.monthKey === filters.monthKey);
    return {
      items: filtered.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / filters.pageSize))
      }
    };
  }

  async findMonthLockByMonthKey(monthKey: string) {
    return this.locks.find((lock) => lock.monthKey === monthKey) ?? null;
  }

  async hasOpenSessions(monthKey: string) {
    return this.openMonths.has(monthKey);
  }

  async createMonthLock(input: {
    monthKey: string;
    lockedByAdminId: number;
    notes?: string;
  }) {
    const lock: MonthLockRecord = {
      id: this.nextId++,
      monthKey: input.monthKey,
      lockedAt: "2026-07-01T00:00:00.000Z",
      lockedByAdminId: input.lockedByAdminId,
      notes: input.notes ?? null
    };

    this.locks.push(lock);
    return lock;
  }
}

describe("month lock service", () => {
  it("creates a month lock for a completed month", async () => {
    const repository = new InMemoryMonthLockRepository();
    const service = createMonthLockService({
      repository,
      now: () => new Date("2026-07-15T10:00:00.000Z")
    });

    const result = await service.createMonthLock(validInput("2026-06"), 9);

    assertMonthLock(result);
    expect(result.monthKey).toBe("2026-06");
    expect(result.lockedByAdminId).toBe(9);
  });

  it("rejects locking the current month", async () => {
    const repository = new InMemoryMonthLockRepository();
    const service = createMonthLockService({
      repository,
      now: () => new Date("2026-07-15T10:00:00.000Z")
    });

    const result = await service.createMonthLock(validInput("2026-07"), 9);

    expect(result).toEqual({
      error: {
        code: "MONTH_LOCK_NOT_ALLOWED",
        message: "Only completed past months can be locked",
        details: {}
      }
    });
  });

  it("rejects locking a month that still has open sessions", async () => {
    const repository = new InMemoryMonthLockRepository();
    repository.openMonths.add("2026-06");
    const service = createMonthLockService({
      repository,
      now: () => new Date("2026-07-15T10:00:00.000Z")
    });

    const result = await service.createMonthLock(validInput("2026-06"), 9);

    expect(result).toEqual({
      error: {
        code: "MONTH_LOCK_HAS_OPEN_SESSIONS",
        message: "Open attendance sessions must be resolved before locking the month",
        details: {}
      }
    });
  });

  it("rejects duplicate month locks", async () => {
    const repository = new InMemoryMonthLockRepository();
    repository.locks.push({
      id: 1,
      monthKey: "2026-06",
      lockedAt: "2026-07-01T00:00:00.000Z",
      lockedByAdminId: 1,
      notes: null
    });
    const service = createMonthLockService({
      repository,
      now: () => new Date("2026-07-15T10:00:00.000Z")
    });

    const result = await service.createMonthLock(validInput("2026-06"), 9);

    expect(result).toEqual({
      error: {
        code: "MONTH_LOCK_ALREADY_EXISTS",
        message: "Month lock already exists",
        details: {}
      }
    });
  });

  it("lists month locks with pagination metadata", async () => {
    const repository = new InMemoryMonthLockRepository();
    repository.locks.push(
      {
        id: 1,
        monthKey: "2026-06",
        lockedAt: "2026-07-01T00:00:00.000Z",
        lockedByAdminId: 1,
        notes: null
      },
      {
        id: 2,
        monthKey: "2026-05",
        lockedAt: "2026-06-01T00:00:00.000Z",
        lockedByAdminId: 1,
        notes: null
      }
    );
    const service = createMonthLockService({
      repository,
      now: () => new Date("2026-07-15T10:00:00.000Z")
    });

    await expect(service.listMonthLocks({ page: 2, pageSize: 1 })).resolves.toEqual({
      items: [
        {
          id: 2,
          monthKey: "2026-05",
          lockedAt: "2026-06-01T00:00:00.000Z",
          lockedByAdminId: 1,
          notes: null
        }
      ],
      pagination: {
        page: 2,
        pageSize: 1,
        total: 2,
        totalPages: 2
      }
    });
  });
});

function validInput(monthKey: string): MonthLockCreateInput {
  return {
    monthKey,
    notes: "Month closed"
  };
}

function assertMonthLock(
  value: Awaited<ReturnType<ReturnType<typeof createMonthLockService>["createMonthLock"]>>
): asserts value is MonthLockRecord {
  expect("error" in value).toBe(false);
}

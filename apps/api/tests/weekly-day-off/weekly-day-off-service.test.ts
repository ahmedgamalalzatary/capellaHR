/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import {
  createWeeklyDayOffService,
  type WeeklyDayRecord,
  type WeeklyDayOffRepository,
} from '../../src/modules/weekly-day-off/index.js';

const absence: WeeklyDayRecord = {
  id: 11,
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'موظف تجريبي',
  branchId: 3,
  branchName: 'فرع القاهرة',
  attendanceDate: '2026-07-10',
  status: 'absence',
  absenceRequiredMinutes: 600,
  requiredMinutes: 600,
  dayOffConvertedAt: null,
  createdAt: new Date('2026-07-11T00:00:00.000Z'),
  updatedAt: new Date('2026-07-11T00:00:00.000Z'),
};

const dayOff: WeeklyDayRecord = {
  ...absence,
  status: 'weekly_day_off',
  requiredMinutes: 0,
  dayOffConvertedAt: new Date('2026-07-18T09:00:00.000Z'),
};

const makeRepository = (): WeeklyDayOffRepository => ({
  findById: vi.fn(async () => absence),
  list: vi.fn(async () => ({ items: [absence], total: 1 })),
  convertToDayOff: vi.fn(async () => ({ kind: 'success' as const, record: dayOff })),
  revertToAbsence: vi.fn(async () => ({ kind: 'success' as const, record: absence })),
});
const isFinanciallyUnlocked = () => Promise.resolve(false);

if (process.env.NODE_ENV === 'typecheck') {
  // @ts-expect-error A financial-lock guard is mandatory at construction.
  createWeeklyDayOffService(makeRepository(), { today: () => '2026-07-18' });
}

describe('weekly day-off service', () => {
  it('lists and gets daily records', async () => {
    const repository = makeRepository();
    const service = createWeeklyDayOffService(repository, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      today: () => '2026-07-18',
    });
    const query = { status: 'absence' as const, page: 1, pageSize: 20 };

    await expect(service.list(query)).resolves.toEqual({ items: [absence], total: 1 });
    await expect(service.get(11)).resolves.toEqual(absence);
    expect(vi.mocked(repository.list)).toHaveBeenCalledWith(query);
  });

  it('converts an eligible absence using the Cairo date and financial lock guard', async () => {
    const repository = makeRepository();
    const isLocked = vi.fn(async () => false);
    const service = createWeeklyDayOffService(repository, {
      today: () => '2026-07-18', isFinanciallyLocked: isLocked,
    });

    await expect(service.convert(11)).resolves.toEqual(dayOff);
    expect(vi.mocked(repository.convertToDayOff)).toHaveBeenCalledWith(
      11, '2026-07-18', isLocked,
    );
  });

  it.each([
    ['not_found', 'WEEKLY_DAY_RECORD_NOT_FOUND'],
    ['not_past', 'WEEKLY_DAY_OFF_DATE_NOT_PAST'],
    ['not_absence', 'WEEKLY_DAY_OFF_INVALID_STATE'],
    ['spacing_conflict', 'WEEKLY_DAY_OFF_SPACING_CONFLICT'],
    ['financially_locked', 'WEEKLY_DAY_OFF_FINANCIALLY_LOCKED'],
  ] as const)('maps conversion result %s to %s', async (kind, code) => {
    const repository = makeRepository();
    vi.mocked(repository.convertToDayOff).mockResolvedValue({ kind });

    await expect(createWeeklyDayOffService(repository, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      today: () => '2026-07-18',
    }).convert(11)).rejects.toMatchObject({ code });
  });

  it('reverts a day off and restores its preserved absence snapshot', async () => {
    const repository = makeRepository();
    const service = createWeeklyDayOffService(repository, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      today: () => '2026-07-18',
    });

    await expect(service.revert(11)).resolves.toEqual(absence);
    expect(vi.mocked(repository.revertToAbsence)).toHaveBeenCalledOnce();
  });

  it.each([
    ['not_found', 'WEEKLY_DAY_RECORD_NOT_FOUND'],
    ['not_day_off', 'WEEKLY_DAY_OFF_INVALID_STATE'],
    ['financially_locked', 'WEEKLY_DAY_OFF_FINANCIALLY_LOCKED'],
  ] as const)('maps reversion result %s to %s', async (kind, code) => {
    const repository = makeRepository();
    vi.mocked(repository.revertToAbsence).mockResolvedValue({ kind });

    await expect(createWeeklyDayOffService(repository, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      today: () => '2026-07-18',
    }).revert(11)).rejects.toMatchObject({ code });
  });
});

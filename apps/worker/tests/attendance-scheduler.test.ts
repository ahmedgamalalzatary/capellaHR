import { describe, expect, it, vi } from 'vitest';

import { scheduleCurrentAttendanceDate } from '../src/attendance-scheduler.js';

describe('attendance absence scheduler', () => {
  it('schedules the open Cairo date for the exact following Cairo midnight', async () => {
    const ensureAbsenceJob = vi.fn(async () => undefined);
    const findMissingAbsenceScheduleStart = vi.fn(async () => '2026-07-20');

    await scheduleCurrentAttendanceDate(
      { ensureAbsenceJob, findMissingAbsenceScheduleStart },
      new Date('2026-07-20T20:59:59.000Z'),
      'Africa/Cairo',
    );

    expect(ensureAbsenceJob).toHaveBeenCalledWith(
      '2026-07-20',
      new Date('2026-07-20T21:00:00.000Z'),
    );
  });

  it('uses the Cairo DST offset when scheduling midnight', async () => {
    const ensureAbsenceJob = vi.fn(async () => undefined);
    const findMissingAbsenceScheduleStart = vi.fn(async () => '2026-12-20');

    await scheduleCurrentAttendanceDate(
      { ensureAbsenceJob, findMissingAbsenceScheduleStart },
      new Date('2026-12-20T12:00:00.000Z'),
      'Africa/Cairo',
    );

    expect(ensureAbsenceJob).toHaveBeenCalledWith(
      '2026-12-20',
      new Date('2026-12-20T22:00:00.000Z'),
    );
  });

  it('backfills every missing Cairo date after worker downtime, including a DST boundary', async () => {
    const ensureAbsenceJob = vi.fn(async () => undefined);

    await scheduleCurrentAttendanceDate(
      {
        ensureAbsenceJob,
        findMissingAbsenceScheduleStart: vi.fn(async () => '2026-04-23'),
      },
      new Date('2026-04-25T09:00:00.000Z'),
      'Africa/Cairo',
    );

    expect(ensureAbsenceJob.mock.calls).toEqual([
      ['2026-04-23', new Date('2026-04-23T22:00:00.000Z')],
      ['2026-04-24', new Date('2026-04-24T21:00:00.000Z')],
      ['2026-04-25', new Date('2026-04-25T21:00:00.000Z')],
    ]);
  });
});

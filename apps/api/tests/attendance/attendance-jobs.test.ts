import { describe, expect, it, vi } from 'vitest';

import {
  createAttendanceJobProcessor,
  type AttendanceJobRepository,
} from '../../src/modules/attendance/attendance-jobs.js';

const timeoutJob = {
  id: 7,
  jobType: 'automatic_timeout' as const,
  sessionId: 11,
  attendanceDate: null,
  status: 'processing' as const,
  runAt: new Date('2026-07-21T01:00:00.000Z'),
  attemptCount: 1,
  lastError: null,
  startedAt: new Date('2026-07-21T01:00:00.000Z'),
  completedAt: null,
  createdAt: new Date('2026-07-20T09:00:00.000Z'),
  updatedAt: new Date('2026-07-21T01:00:00.000Z'),
};

const makeRepository = (): AttendanceJobRepository => ({
  findMissingAbsenceScheduleStart: vi.fn().mockResolvedValue(null),
  ensureAbsenceJob: vi.fn(),
  claimNext: vi.fn().mockResolvedValue(null),
  processAutomaticTimeout: vi.fn(),
  generateAbsences: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  recoverStale: vi.fn(),
  reconcileFailed: vi.fn(),
});

describe('attendance job processor', () => {
  it('returns null when no durable attendance job is due', async () => {
    const repository = makeRepository();

    await expect(createAttendanceJobProcessor(repository).processNext()).resolves.toBeNull();

    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('runs and completes an automatic timeout job', async () => {
    const repository = makeRepository();
    vi.mocked(repository.claimNext).mockResolvedValue(timeoutJob);

    await expect(createAttendanceJobProcessor(repository).processNext()).resolves.toEqual(timeoutJob);

    expect(repository.processAutomaticTimeout).toHaveBeenCalledWith(11);
    expect(repository.complete).toHaveBeenCalledWith(7);
  });

  it('persists only a stable safe reason before propagating an execution error', async () => {
    const repository = makeRepository();
    vi.mocked(repository.claimNext).mockResolvedValue(timeoutJob);
    vi.mocked(repository.processAutomaticTimeout).mockRejectedValue(
      new Error('select * from auth_sessions where token = super-secret'),
    );

    await expect(createAttendanceJobProcessor(repository).processNext())
      .rejects.toThrow('super-secret');

    expect(repository.fail).toHaveBeenCalledWith(7, 'AUTOMATIC_TIMEOUT_FAILED');
    expect(repository.complete).not.toHaveBeenCalled();
  });
});

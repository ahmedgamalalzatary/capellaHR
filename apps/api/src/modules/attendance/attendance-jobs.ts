export type AttendanceJob = {
  id: number;
  jobType: 'automatic_timeout' | 'absence_generation';
  sessionId: number | null;
  attendanceDate: string | null;
  status: 'scheduled' | 'processing' | 'completed' | 'failed';
  runAt: Date;
  attemptCount: number;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AttendanceJobFailureReason =
  | 'AUTOMATIC_TIMEOUT_FAILED'
  | 'ABSENCE_GENERATION_FAILED';

export interface AttendanceJobRepository {
  findMissingAbsenceScheduleStart(this: void, throughDate: string): Promise<string | null>;
  ensureAbsenceJob(this: void, date: string, runAt: Date): Promise<unknown>;
  claimNext(this: void): Promise<AttendanceJob | null>;
  processAutomaticTimeout(this: void, sessionId: number): Promise<unknown>;
  generateAbsences(this: void, date: string): Promise<unknown>;
  complete(this: void, id: number): Promise<unknown>;
  fail(this: void, id: number, reason: AttendanceJobFailureReason): Promise<unknown>;
  recoverStale(this: void, staleBefore: Date): Promise<unknown>;
  reconcileFailed(this: void): Promise<unknown>;
}

export const createAttendanceJobProcessor = (repository: AttendanceJobRepository) => ({
  async processNext() {
    const job = await repository.claimNext();
    if (!job) return null;
    try {
      if (job.jobType === 'automatic_timeout') {
        if (job.sessionId === null) throw new Error('Automatic-timeout job has no session');
        await repository.processAutomaticTimeout(job.sessionId);
      } else {
        if (job.attendanceDate === null) throw new Error('Absence-generation job has no date');
        await repository.generateAbsences(job.attendanceDate);
      }
      await repository.complete(job.id);
      return job;
    } catch (error) {
      await repository.fail(
        job.id,
        job.jobType === 'automatic_timeout'
          ? 'AUTOMATIC_TIMEOUT_FAILED'
          : 'ABSENCE_GENERATION_FAILED',
      );
      throw error;
    }
  },
});

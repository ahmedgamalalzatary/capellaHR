import { attendanceDeniedAttempts, auditEvents } from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFixtures,
  cleanDatabase,
  database,
  repository,
} from './attendance-mysql-fixtures.js';

const control = vi.hoisted(() => ({ hideNextReRead: false }));

// Simulates the denied attempt vanishing between the approval update and its re-read,
// which no ordinary caller can trigger from outside the transaction.
vi.mock('../../src/modules/attendance/attendance-repository-support.js', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../src/modules/attendance/attendance-repository-support.js')
  >();
  return {
    ...original,
    findDenied: (...args: Parameters<typeof original.findDenied>) => {
      if (!control.hideNextReRead) return original.findDenied(...args);
      control.hideNextReRead = false;
      return Promise.resolve(null);
    },
  };
});

beforeEach(async () => {
  control.hideNextReRead = false;
  await cleanDatabase();
});
afterEach(cleanDatabase);

const recordAttempt = async (employeeId: number, deviceId: number) => repository().recordDeniedAttempt({
  eventType: 'check_in',
  claimedEmployeeCode: 42,
  employeeId,
  source: 'personal_device',
  deviceId,
  occurredAt: new Date('2026-07-19T06:00:00.000Z'),
  latitude: 30.0444,
  longitude: 31.2357,
  gpsAccuracyMeters: 8,
  distanceMeters: 0,
  branchLatitude: 30.0444,
  branchLongitude: 31.2357,
  branchRadiusMeters: 150,
  failureReason: 'DEVICE_INVALID',
  suspicious: true,
});

describe('MySQL-backed denied attendance approval re-reads', () => {
  it('throws instead of auditing a null state when the approved attempt disappears', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();
    const attempt = await recordAttempt(employeeId, deviceId);
    control.hideNextReRead = true;

    await expect(repo.approveDeniedAttempt(attempt.id)).rejects.toThrow(/disappeared/i);

    expect(await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'approve_denied_attempt'))).toEqual([]);
    expect((await database.select().from(attendanceDeniedAttempts)
      .where(eq(attendanceDeniedAttempts.id, attempt.id)))[0])
      .toMatchObject({ approvedAt: null, approvedSessionId: null });
  });

  it('audits the persisted post-approval state when the attempt is still present', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();
    const attempt = await recordAttempt(employeeId, deviceId);

    await expect(repo.approveDeniedAttempt(attempt.id)).resolves.toMatchObject({ kind: 'success' });

    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'approve_denied_attempt')))[0]?.afterState)
      .toEqual(expect.objectContaining({ id: attempt.id, approvedSessionId: expect.any(Number) }));
  });
});

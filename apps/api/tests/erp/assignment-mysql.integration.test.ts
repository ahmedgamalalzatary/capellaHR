import { branches, employees } from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/attendance-repository.js';
import {
  cleanDatabase,
  createFixtures,
  database,
  fixedNow,
  repository,
} from '../attendance/attendance-mysql-fixtures.js';

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

const otherBranch = async () => {
  const name = `فرع آخر ${Date.now()}`;
  const result = await database.insert(branches).values({
    name,
    nameNormalized: name,
    location: 'الجيزة',
    latitude: 30,
    longitude: 31,
    gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 100,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  return Number(result[0].insertId);
};

describe('MySQL-backed present-employee assignment eligibility', () => {
  it('finds only the checked-in employee of the requested branch', async () => {
    const { branchId, employeeId } = await createFixtures();
    const repo = repository();
    await repo.manualCheckIn({ employeeId, occurredAt: fixedNow });

    await expect(repo.findPresentEmployee(branchId, employeeId)).resolves.toEqual({
      id: employeeId,
      employeeCode: 42,
      fullName: 'موظف الحضور',
      branchId,
    });
    // Branch isolation: the same employee is invisible from another branch.
    await expect(repo.findPresentEmployee(await otherBranch(), employeeId)).resolves.toBeNull();
  });

  it('reports an employee who never checked in as absent', async () => {
    const { branchId, employeeId } = await createFixtures();

    await expect(repository().findPresentEmployee(branchId, employeeId)).resolves.toBeNull();
  });

  it('stops assignment as soon as the employee checks out', async () => {
    const { branchId, employeeId } = await createFixtures();
    const repo = repository();
    await repo.manualCheckIn({ employeeId, occurredAt: fixedNow });
    expect(await repo.findPresentEmployee(branchId, employeeId)).not.toBeNull();

    await repo.manualCheckOut({
      employeeId,
      occurredAt: new Date(fixedNow.getTime() + 60 * 60_000),
    });

    await expect(repo.findPresentEmployee(branchId, employeeId)).resolves.toBeNull();
    await expect(repo.listPresentEmployees(branchId)).resolves.toEqual([]);
  });

  it('excludes deactivated and soft-deleted employees while their session is open', async () => {
    const { branchId, employeeId } = await createFixtures();
    const repo = repository();
    await repo.manualCheckIn({ employeeId, occurredAt: fixedNow });

    await database.update(employees).set({ employmentStatus: 'inactive' })
      .where(eq(employees.id, employeeId));
    await expect(repo.findPresentEmployee(branchId, employeeId)).resolves.toBeNull();

    await database.update(employees).set({ employmentStatus: 'active', deletedAt: fixedNow })
      .where(eq(employees.id, employeeId));
    await expect(repo.findPresentEmployee(branchId, employeeId)).resolves.toBeNull();
  });

  it('does not treat a session past the sixteen-hour timeout as presence', async () => {
    const { branchId, employeeId } = await createFixtures();
    await repository().manualCheckIn({ employeeId, occurredAt: fixedNow });
    const overdue = createDrizzleAttendanceRepository(database, {
      now: () => new Date(fixedNow.getTime() + 16 * 60 * 60_000),
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
    });

    await expect(overdue.findPresentEmployee(branchId, employeeId)).resolves.toBeNull();
    await expect(overdue.listPresentEmployees(branchId)).resolves.toEqual([]);
  });

  it('re-checks presence inside a caller transaction', async () => {
    const { branchId, employeeId } = await createFixtures();
    const repo = repository();
    await repo.manualCheckIn({ employeeId, occurredAt: fixedNow });

    const seen = await database.transaction(async (transaction) => (
      repo.findPresentEmployee(branchId, employeeId, transaction)
    ));

    expect(seen).toMatchObject({ id: employeeId, branchId });
  });
});

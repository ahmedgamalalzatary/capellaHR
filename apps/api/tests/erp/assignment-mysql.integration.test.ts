import { branches, employees } from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
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

  it('serializes a transactional sale presence check against checkout', async () => {
    const { branchId, employeeId } = await createFixtures();
    const repo = repository();
    await repo.manualCheckIn({ employeeId, occurredAt: fixedNow });
    let releaseSale!: () => void;
    let markSaleReady!: (connectionId: number) => void;
    const saleRelease = new Promise<void>((resolve) => { releaseSale = resolve; });
    const saleReady = new Promise<number>((resolve) => { markSaleReady = resolve; });

    const saleCheck = database.transaction(async (transaction) => {
      const connection = await transaction.execute(sql`select connection_id() as connectionId`);
      const connectionId = Number(
        (connection[0] as unknown as Array<{ connectionId: number }>)[0]?.connectionId,
      );
      expect(await repo.findPresentEmployee(branchId, employeeId, transaction)).not.toBeNull();
      markSaleReady(connectionId);
      await saleRelease;
    });

    const saleConnectionId = await saleReady;
    const checkout = repo.manualCheckOut({
      employeeId,
      occurredAt: new Date(fixedNow.getTime() + 60 * 60_000),
    });
    const waitDeadline = Date.now() + 5_000;
    let checkoutWaitObserved = false;
    while (!checkoutWaitObserved && Date.now() < waitDeadline) {
      const result = await database.execute(sql`
        select exists(
          select 1
          from performance_schema.data_lock_waits waits
          join performance_schema.data_locks requested
            on requested.engine_lock_id = waits.requesting_engine_lock_id
          join information_schema.innodb_trx blocker
            on blocker.trx_id = waits.blocking_engine_transaction_id
          where requested.object_schema = database()
            and requested.object_name in ('employees', 'attendance_sessions')
            and blocker.trx_mysql_thread_id = ${saleConnectionId}
        ) as waiting
      `);
      checkoutWaitObserved = Number(
        (result[0] as unknown as Array<{ waiting: number }>)[0]?.waiting,
      ) === 1;
      if (!checkoutWaitObserved) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    releaseSale();
    await Promise.all([saleCheck, checkout]);

    expect(checkoutWaitObserved).toBe(true);
    await expect(repo.findPresentEmployee(branchId, employeeId)).resolves.toBeNull();
  });
});

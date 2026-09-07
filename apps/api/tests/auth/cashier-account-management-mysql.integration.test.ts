import { accounts, authSessions, branches, branchCashierRoster, employees } from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createCashierAccountsService, createDrizzleCashierAccountRepository } from '../../src/modules/auth/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
beforeAll(() => prepareMysqlIntegrationDatabase(database), 120_000);
afterAll(() => closeMysqlIntegrationDatabase(database), 30_000);

it('persists the complete account, preserves omitted credentials, and rolls back failed roster writes in MySQL', async () => {
  const now = new Date();
  const branchId = Number((await database.insert(branches).values({
    name: 'Cashier management test', nameNormalized: 'cashier-management-test', location: 'Cairo',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    createdAt: now, updatedAt: now,
  }))[0].insertId);
  const employeeId = Number((await database.insert(employees).values({
    employeeCode: 77001, fullName: 'Permitted seller', personalPhone: '01012345678', whatsappPhone: '01012345678',
    pinHash: 'unused', age: 25, address: 'Cairo', branchId, shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000', createdAt: now, updatedAt: now,
  }))[0].insertId);
  const service = createCashierAccountsService({ accounts: createDrizzleCashierAccountRepository(database), hashPassword: async (value) => `hash:${value}` });
  const created = await service.save({ mode: 'create', branchId, username: 'Till', password: 'secret', employeeIds: [employeeId] });
  expect(created.username).toBe('till');
  expect(created.employees).toEqual([{ id: employeeId, fullName: 'Permitted seller' }]);
  expect(await database.select({ employeeId: branchCashierRoster.employeeId }).from(branchCashierRoster).where(eq(branchCashierRoster.branchId, branchId)))
    .toEqual([{ employeeId }]);
  await service.setActive(created.id, false);
  const edit = { mode: 'edit' as const, accountId: created.id, branchId, username: 'till', employeeIds: [] };
  await service.save(edit);
  const readAccount = async () => (await database.select({ username: accounts.username, passwordHash: accounts.passwordHash, active: accounts.active }).from(accounts).where(eq(accounts.id, created.id)))[0];
  expect(await readAccount()).toEqual({ username: 'till', passwordHash: 'hash:secret', active: false });
  expect(await database.select().from(branchCashierRoster).where(eq(branchCashierRoster.branchId, branchId))).toEqual([]);
  await expect(service.save({ mode: 'create', branchId, username: 'replacement', password: 'secret', employeeIds: [] }))
    .rejects.toMatchObject({ code: 'BRANCH_HAS_ACCOUNT' });
  await expect(service.save({ ...edit, username: 'invalid', employeeIds: [2147483647] }))
    .rejects.toMatchObject({ code: 'ERP_ROSTER_EMPLOYEE_INVALID' });

  // Fault injection in the isolated test database: fail after the credential update.
  await database.$client.promise().query("CREATE TRIGGER cashier_roster_failure BEFORE INSERT ON erp_branch_cashier_roster FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'roster write failure'");
  try {
    await expect(service.save({ ...edit, username: 'must-rollback', password: 'must-rollback', employeeIds: [employeeId] })).rejects.toThrow();
    expect(await readAccount()).toEqual({ username: 'till', passwordHash: 'hash:secret', active: false });
  } finally {
    await database.$client.promise().query('DROP TRIGGER cashier_roster_failure');
  }
  await database.insert(authSessions).values({ id: 'cashier-management-session', tokenHash: 'a'.repeat(64), actorType: 'account', accountId: created.id, createdAt: now, expiresAt: new Date(now.getTime() + 60_000) });
  await service.save({ ...edit, password: 'replacement', employeeIds: [employeeId] });
  expect(await readAccount()).toEqual({ username: 'till', passwordHash: 'hash:replacement', active: false });
  const [session] = await database.select().from(authSessions).where(eq(authSessions.id, 'cashier-management-session'));
  expect(session?.revokedAt).toBeInstanceOf(Date);
});

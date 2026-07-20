import { createDatabase } from '@capella/database';
import { attendanceDailyRecords, auditEvents, authSessions, branches, deviceAuthenticationChallenges, deviceHistory, devicePairingRequests, devices, employeeCodeSequence, employeeImages, employeePhoneReservations, employees } from '@capella/database/schema';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDrizzleAuthRepositories } from '../../src/modules/auth/index.js';
import { createDrizzleEmployeeRepository, createEmployeeService, createEmployeesModule } from '../../src/modules/employees/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const branchModule = createBranchesModule(database); const employeeModule = createEmployeesModule(database, 16_777_216, { hasOpenSession: async () => false });
const image = (name: string) => ({ storagePath: `employees/${name}.jpg`, originalName: `${name}.jpg`, mimeType: 'image/jpeg', sizeBytes: 10 });
const employee = (branchId: number, phone: string) => ({ fullName: 'موظف', personalPhone: phone, whatsappPhone: phone, pin: '1234', age: 30, address: 'القاهرة', branchId, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: image(`${phone}-p`), idFront: image(`${phone}-f`), idBack: image(`${phone}-b`) } });

beforeEach(async () => { await database.delete(auditEvents); await database.delete(attendanceDailyRecords); await database.delete(deviceAuthenticationChallenges); await database.delete(deviceHistory); await database.delete(devices); await database.delete(devicePairingRequests); await database.delete(authSessions); await database.delete(employeeImages); await database.delete(employeePhoneReservations); await database.delete(employees); await database.delete(employeeCodeSequence); await database.delete(branches); });
describe('MySQL-backed employees', () => {
  it('creates concurrent employees with distinct incremental codes and locks the branch', async () => {
    const branch = await branchModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await Promise.all([employeeModule.service.create(employee(branch.id, '01012345678')), employeeModule.service.create(employee(branch.id, '01112345678'))]);
    expect(created.map((item) => item.employeeCode).sort()).toEqual([1, 2]);
    expect((await employeeModule.service.list({ search: '%', page: 1, pageSize: 20 })).total).toBe(0);
    await expect(branchModule.service.remove(branch.id)).rejects.toMatchObject({ code: 'BRANCH_REFERENCED' });
  });
  it('reserves deleted employee phones and hides the employee', async () => {
    const branch = await branchModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await employeeModule.service.create(employee(branch.id, '01012345678')); await employeeModule.service.remove(created.id);
    expect((await employeeModule.service.list({ page: 1, pageSize: 20 })).total).toBe(0);
    await expect(employeeModule.service.create({ ...employee(branch.id, '01112345678'), whatsappPhone: '01012345678' })).rejects.toMatchObject({ code: 'EMPLOYEE_PHONE_EXISTS' });
  });
  it('atomically revokes sessions on PIN reset and deletion', async () => {
    const branch = await branchModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await employeeModule.service.create(employee(branch.id, '01012345678'));
    await database.insert(authSessions).values({ id: 'pin-reset-session', tokenHash: 'a'.repeat(64), actorType: 'employee', employeeId: created.id, createdAt: new Date(), revokedAt: null });
    await employeeModule.service.update(created.id, { pin: '4321' });
    expect((await database.select().from(authSessions).where(eq(authSessions.id, 'pin-reset-session')))[0]!.revokedAt).not.toBeNull();
    await expect(createDrizzleAuthRepositories(database).sessions.createEmployeeIfCurrent({ id: 'stale-login', tokenHash: 'c'.repeat(64), actorType: 'employee', employeeId: created.id, revokedAt: null }, 1)).resolves.toBe(false);
    await database.insert(authSessions).values({ id: 'delete-session', tokenHash: 'b'.repeat(64), actorType: 'employee', employeeId: created.id, createdAt: new Date(), revokedAt: null });
    await employeeModule.service.remove(created.id);
    expect((await database.select().from(authSessions).where(eq(authSessions.id, 'delete-session')))[0]!.revokedAt).not.toBeNull();
    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'employees')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(['create', 'pin_reset', 'delete']);
    const sessionEvents = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'auth')).orderBy(asc(auditEvents.id));
    expect(sessionEvents.map(({ action, entityId, relatedIds }) => ({
      action, entityId, relatedIds,
    }))).toEqual([
      { action: 'session_revoke', entityId: 'pin-reset-session', relatedIds: { employeeId: String(created.id) } },
      { action: 'session_revoke', entityId: 'delete-session', relatedIds: { employeeId: String(created.id) } },
    ]);
    expect(events[0]?.afterState).toMatchObject({ pinHash: '[REDACTED]' });
    expect(JSON.stringify(events)).not.toContain('$argon2');
  });
  it('returns branch-not-found when the branch is deleted after the preliminary check', async () => {
    const branch = await branchModule.service.create({ name: 'Race branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const repository = createDrizzleEmployeeRepository(database);
    let releaseCheck!: () => void;
    let signalChecked!: () => void;
    const checked = new Promise<void>((resolve) => { signalChecked = resolve; });
    const released = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const service = createEmployeeService({
      ...repository,
      async branchExists(id) {
        const exists = await repository.branchExists(id);
        signalChecked();
        await released;
        return exists;
      },
    });

    const creation = service.create(employee(branch.id, '01012345678'));
    await checked;
    await branchModule.service.remove(branch.id);
    releaseCheck();

    await expect(creation).rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_FOUND' });
  });
});

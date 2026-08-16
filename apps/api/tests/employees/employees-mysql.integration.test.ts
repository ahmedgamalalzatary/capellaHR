import { createDatabase } from '@capella/database';
import { attendanceDailyRecords, attendanceJobs, auditEvents, authSessions, branchCashierRoster, branches, deviceHistory, devicePairingRequests, devices, employeeBranchAssignments, employeeCodeSequence, employeeEmploymentPeriods, employeeImages, employeePhoneReservations, employees } from '@capella/database/schema';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDrizzleAuthRepositories } from '../../src/modules/auth/index.js';
import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/index.js';
import { createDrizzleEmployeeRepository, createEmployeeService, createEmployeesModule } from '../../src/modules/employees/index.js';
import { createShiftsModule } from '../../src/modules/shifts/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const branchModule = createBranchesModule(database); const employeeModule = createEmployeesModule(database, 16_777_216, { hasOpenSession: async () => false, hasAnyOpenSession: async () => false });
const image = (name: string) => ({ storagePath: `employees/${name}.jpg`, originalName: `${name}.jpg`, mimeType: 'image/jpeg', sizeBytes: 10 });
const employee = (branchId: number, phone: string) => ({ fullName: 'موظف', personalPhone: phone, whatsappPhone: phone, pin: '1234', age: 30, address: 'القاهرة', branchId, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: image(`${phone}-p`), idFront: image(`${phone}-f`), idBack: image(`${phone}-b`) } });
// This module is wired without a financial lifecycle, so the repository ignores the decision
// fields and only the deactivation itself is under test.
const deactivation = { advanceDecision: 'sum_all', negativeBalanceDecision: 'record_debt', expectedUnpaidInstallmentCount: 0, expectedUnpaidAdvanceAmount: '0.00', expectedProjectedNetSalary: '0.00', expectedAmountOwed: '0.00' } as const;

beforeEach(async () => { await database.delete(auditEvents); await database.delete(attendanceDailyRecords); await database.delete(attendanceJobs); await database.delete(deviceHistory); await database.delete(devices); await database.delete(devicePairingRequests); await database.delete(authSessions); await database.delete(branchCashierRoster); await database.delete(employeeImages); await database.delete(employeePhoneReservations); await database.delete(employeeBranchAssignments); await database.delete(employeeEmploymentPeriods); await database.delete(employees); await database.delete(employeeCodeSequence); await database.delete(branches); });
describe('MySQL-backed employees', () => {
  it('atomically reassigns a checked-out employee and preserves branch history', async () => {
    const oldBranch = await branchModule.service.create({ name: 'Old branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const newBranch = await branchModule.service.create({ name: 'New branch', location: 'Giza', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await employeeModule.service.create(employee(oldBranch.id, '01012345678'));
    await database.insert(branchCashierRoster).values({
      branchId: oldBranch.id,
      employeeId: created.id,
      createdAt: new Date(),
    });
    const rosterMembership = (await database.select({ id: branchCashierRoster.id })
      .from(branchCashierRoster).where(eq(branchCashierRoster.employeeId, created.id)).limit(1))[0];
    if (!rosterMembership) throw new Error('Expected the roster membership fixture to exist');

    const updated = await employeeModule.service.update(created.id, { branchId: newBranch.id });

    expect(updated.employee.branchId).toBe(newBranch.id);
    expect(await database.select().from(branchCashierRoster)
      .where(eq(branchCashierRoster.employeeId, created.id))).toHaveLength(0);
    const history = await database.select().from(employeeBranchAssignments)
      .where(eq(employeeBranchAssignments.employeeId, created.id)).orderBy(asc(employeeBranchAssignments.effectiveFrom));
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ branchId: oldBranch.id });
    expect(history[0]!.effectiveTo).not.toBeNull();
    expect(history[1]).toMatchObject({ branchId: newBranch.id, effectiveTo: null });
    await expect(database.insert(employeeBranchAssignments).values({
      employeeId: created.id, branchId: oldBranch.id, effectiveFrom: new Date(), createdAt: new Date(),
    })).rejects.toThrow();
    const event = (await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'branch_reassign')).limit(1))[0];
    expect(event?.relatedIds).toEqual({ previousBranchId: String(oldBranch.id), branchId: String(newBranch.id) });
    const rosterEvent = (await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'remove_on_branch_reassign')).limit(1))[0];
    expect(rosterEvent).toMatchObject({
      entityType: 'branch_cashier_roster',
      entityId: String(rosterMembership.id),
      relatedIds: { branchId: String(oldBranch.id), employeeId: String(created.id) },
    });
  });
  it('creates concurrent employees with distinct incremental codes and locks the branch', async () => {
    const branch = await branchModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await Promise.all([employeeModule.service.create(employee(branch.id, '01012345678')), employeeModule.service.create(employee(branch.id, '01112345678'))]);
    expect(created.map((item) => item.employeeCode).sort()).toEqual([1, 2]);
    expect((await employeeModule.service.list({ search: '%', page: 1, pageSize: 20 })).total).toBe(0);
    await expect(branchModule.service.remove(branch.id)).rejects.toMatchObject({ code: 'BRANCH_REFERENCED' });
  });
  it('releases deleted employee phones while preserving the employee history', async () => {
    const branch = await branchModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await employeeModule.service.create(employee(branch.id, '01012345678')); await employeeModule.service.remove(created.id);
    expect((await employeeModule.service.list({ page: 1, pageSize: 20 })).total).toBe(0);
    expect((await database.select().from(employees).where(eq(employees.id, created.id)))[0]?.deletedAt).not.toBeNull();
    expect((await database.select().from(employeeEmploymentPeriods)
      .where(eq(employeeEmploymentPeriods.employeeId, created.id)))[0]?.activeTo).not.toBeNull();
    expect(await database.select().from(employeePhoneReservations)
      .where(eq(employeePhoneReservations.employeeId, created.id))).toHaveLength(0);
    await expect(employeeModule.service.create({
      ...employee(branch.id, '01112345678'),
      whatsappPhone: '01012345678',
    })).resolves.toMatchObject({ personalPhone: '01112345678', whatsappPhone: '01012345678' });
  });
  it('revokes sessions on deactivation so reactivation cannot resurrect them', async () => {
    const branch = await branchModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await employeeModule.service.create(employee(branch.id, '01012345678'));
    await database.insert(authSessions).values({ id: 'deactivate-session', tokenHash: 'd'.repeat(64), actorType: 'employee', employeeId: created.id, createdAt: new Date(), revokedAt: null });

    await employeeModule.service.deactivate(created.id, deactivation);

    expect((await database.select().from(authSessions).where(eq(authSessions.id, 'deactivate-session')))[0]!.revokedAt).not.toBeNull();
    await expect(employeeModule.service.create({
      ...employee(branch.id, '01112345678'),
      whatsappPhone: '01012345678',
    })).rejects.toMatchObject({ code: 'EMPLOYEE_PHONE_EXISTS' });
    await employeeModule.service.activate(created.id);
    // Reactivation must not restore access: the session stays revoked and the pre-deactivation
    // credential version is stale, so tokens minted before deactivation cannot be replayed.
    expect((await database.select().from(authSessions).where(eq(authSessions.id, 'deactivate-session')))[0]!.revokedAt).not.toBeNull();
    await expect(createDrizzleAuthRepositories(database).sessions.createEmployeeIfCurrent(
      { id: 'stale-after-reactivation', tokenHash: 'e'.repeat(64), actorType: 'employee', employeeId: created.id, expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: null },
      1,
      () => Promise.resolve(true),
      () => Promise.resolve(true),
    )).resolves.toBe('credentials_changed');
    const sessionEvents = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'auth')).orderBy(asc(auditEvents.id));
    expect(sessionEvents.map(({ action, entityId, relatedIds }) => ({ action, entityId, relatedIds }))).toEqual([
      { action: 'session_revoke', entityId: 'deactivate-session', relatedIds: { employeeId: String(created.id) } },
    ]);
  });
  it('atomically revokes sessions on PIN reset and deletion', async () => {
    const branch = await branchModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const created = await employeeModule.service.create(employee(branch.id, '01012345678'));
    await database.insert(authSessions).values({ id: 'pin-reset-session', tokenHash: 'a'.repeat(64), actorType: 'employee', employeeId: created.id, createdAt: new Date(), revokedAt: null });
    await employeeModule.service.update(created.id, { pin: '4321' });
    expect((await database.select().from(authSessions).where(eq(authSessions.id, 'pin-reset-session')))[0]!.revokedAt).not.toBeNull();
    await expect(createDrizzleAuthRepositories(database).sessions.createEmployeeIfCurrent(
      { id: 'stale-login', tokenHash: 'c'.repeat(64), actorType: 'employee', employeeId: created.id, expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: null },
      1,
      () => Promise.resolve(true),
      () => Promise.resolve(true),
    )).resolves.toBe('credentials_changed');
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

  it('snapshots the old duration when an employee edit races midnight absence generation', async () => {
    const branch = await branchModule.service.create({ name: 'Employee edit race', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    let clock = new Date('2026-07-01T09:00:00.000Z');
    let reconcile: NonNullable<Parameters<typeof createDrizzleEmployeeRepository>[2]> = () => Promise.resolve(0);
    let signalEditLocked!: () => void;
    let releaseEdit!: () => void;
    const editLocked = new Promise<void>((resolve) => { signalEditLocked = resolve; });
    const editReleased = new Promise<void>((resolve) => { releaseEdit = resolve; });
    let gateEdit = false;
    const repository = createDrizzleEmployeeRepository(
      database,
      () => clock,
      async (...input) => {
        if (gateEdit) {
          signalEditLocked();
          await editReleased;
        }
        return reconcile(...input);
      },
    );
    const service = createEmployeeService(repository);
    const shifts = createShiftsModule(database);
    const attendance = createDrizzleAttendanceRepository(database, {
      now: () => clock,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: (employeeId, context, includeDeleted) => (
        shifts.service.readRequiredDurationForCheckIn(employeeId, context, includeDeleted)
      ),
    });
    reconcile = attendance.reconcileDueAbsencesForEmployee;
    const created = await service.create(employee(branch.id, '01012345678'));
    clock = new Date('2026-07-20T21:00:01.000Z');
    await attendance.ensureAbsenceJob('2026-07-20', new Date('2026-07-20T21:00:00.000Z'));
    gateEdit = true;

    const edit = service.update(created.id, { shiftDurationMinutes: 480 });
    await editLocked;
    const generation = attendance.generateAbsences('2026-07-20');
    releaseEdit();
    await Promise.all([edit, generation]);

    expect((await database.select().from(attendanceDailyRecords))[0]).toMatchObject({
      employeeId: created.id,
      attendanceDate: '2026-07-20',
      absenceRequiredMinutes: 600,
    });
    expect((await database.select({ duration: employees.shiftDurationMinutes })
      .from(employees).where(eq(employees.id, created.id)))[0]?.duration).toBe(480);
  });
});

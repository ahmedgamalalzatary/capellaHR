import { createHash } from 'node:crypto';

import { createDatabase } from '@capella/database';
import { attendanceDailyRecords, auditEvents, authSessions, branches, deviceHistory, devicePairingRequests, devices, employeeCodeSequence, employeeImages, employeePhoneReservations, employees } from '@capella/database/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import { createAuthModule } from '../../src/modules/auth/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDevicesModule } from '../../src/modules/devices/index.js';
import { createDrizzleDeviceRepository } from '../../src/modules/devices/devices-repository.js';
import { createEmployeesModule } from '../../src/modules/employees/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? ''); const module = createDevicesModule(database); const branchesModule = createBranchesModule(database); const employeesModule = createEmployeesModule(database, 16_777_216, { hasOpenSession: async () => false }, undefined, module.lifecycle);
beforeEach(async () => { await database.delete(auditEvents); await database.delete(attendanceDailyRecords); await database.delete(deviceHistory); await database.delete(devices); await database.delete(devicePairingRequests); await database.delete(authSessions); await database.delete(employeeImages); await database.delete(employeePhoneReservations); await database.delete(employees); await database.delete(employeeCodeSequence); await database.delete(branches); });
const complete = (token: string, marker: string) => module.service.completePairing(token, { installationMarker: `marker-${marker}`.padEnd(16, 'x'), browser: 'Chrome', platform: 'Android' });

describe('MySQL-backed devices', () => {
  it('audits pairing and revocation without marker material', async () => {
    const branch = await branchesModule.service.create({ name: 'Audited branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const pairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    const active = await complete(pairing.pairingToken, 'audited');
    await module.service.revoke(active.id);

    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'devices')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual([
      'pairing_create', 'pairing_complete', 'revoke',
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('marker-audited');
  });

  it('searches browser, platform, and assigned branch while returning assignment identity', async () => {
    const branch = await branchesModule.service.create({ name: 'Searchable branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const pairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    const active = await complete(pairing.pairingToken, 'searchable');

    expect(active.assignmentName).toBe('Searchable branch');
    await expect(module.service.get(active.id)).resolves.toMatchObject({ assignmentName: 'Searchable branch' });

    for (const search of ['Chrome', 'Android', 'Searchable']) {
      await expect(module.service.list({ search, page: 1, pageSize: 20 })).resolves.toMatchObject({
        total: 1,
        items: [{ assignmentId: branch.id, assignmentName: 'Searchable branch' }],
      });
    }
    await expect(module.service.list({ search: '%', page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('supersedes pending links and consumes the successful link once', async () => {
    const branch = await branchesModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const first = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id }); const second = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    await expect(complete(first.pairingToken, 'old')).rejects.toMatchObject({ code: 'DEVICE_PAIRING_INVALID' });
    await expect(complete(second.pairingToken, 'new')).resolves.toMatchObject({ status: 'active' });
    await expect(complete(second.pairingToken, 'again')).rejects.toMatchObject({ code: 'DEVICE_PAIRING_INVALID' });
  });
  it('leaves only one usable request under concurrent pairing creation', async () => {
    const branch = await branchesModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const pairings = await Promise.all([module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id }), module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id })]);
    const pendingBeforeCompletion = await database.select().from(devicePairingRequests).where(eq(devicePairingRequests.status, 'pending'));
    expect(pendingBeforeCompletion).toHaveLength(1);
    const results = await Promise.allSettled(pairings.map((pairing, index) => complete(pairing.pairingToken, `concurrent-${index}`)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const pending = await database.select().from(devicePairingRequests).where(eq(devicePairingRequests.status, 'pending'));
    expect(pending).toHaveLength(0);
  });

  it('serializes concurrent initial completions to one active device', async () => {
    const branch = await branchesModule.service.create({ name: 'Concurrent branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const first = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    const firstCompletion = complete(first.pairingToken, 'first-concurrent-device');
    const second = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    const secondCompletion = complete(second.pairingToken, 'second-concurrent-device');
    await Promise.allSettled([firstCompletion, secondCompletion]);

    const active = await database.select().from(devices).where(and(eq(devices.branchId, branch.id), eq(devices.status, 'active')));
    expect(active).toHaveLength(1);
  });
  it('keeps the old device active until replacement succeeds then revokes it', async () => {
    const branch = await branchesModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const first = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id }); const old = await complete(first.pairingToken, 'old');
    const replacement = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id }); expect((await module.service.get(old.id)).status).toBe('active');
    await complete(replacement.pairingToken, 'new'); expect((await module.service.get(old.id)).status).toBe('revoked');
  });
  it('allows the same browser profile to re-register for its original assignment', async () => {
    const branch = await branchesModule.service.create({ name: 'Same phone', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const firstPairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    const first = await complete(firstPairing.pairingToken, 'same-phone');
    await module.service.revoke(first.id);
    const secondPairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    await expect(complete(secondPairing.pairingToken, 'same-phone')).resolves.toMatchObject({ status: 'active' });
    const release = (await database.select().from(auditEvents)
      .where(and(eq(auditEvents.module, 'devices'), eq(auditEvents.action, 'installation_marker_release'))))[0];
    expect(release).toMatchObject({
      entityType: 'device', entityId: String(first.id),
      beforeState: { assigned: true },
      afterState: { assigned: false },
      relatedIds: { assignmentId: String(branch.id) },
    });
    expect(JSON.stringify(release)).not.toContain('same-phone');
  });
  it('allows a revoked browser marker to pair with a different branch', async () => {
    const firstBranch = await branchesModule.service.create({ name: 'First marker branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const secondBranch = await branchesModule.service.create({ name: 'Second marker branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const marker = 'reassigned-marker';
    const firstPairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: firstBranch.id });
    const firstDevice = await complete(firstPairing.pairingToken, marker);
    await module.service.revoke(firstDevice.id);

    const secondPairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: secondBranch.id });
    await expect(complete(secondPairing.pairingToken, marker)).resolves.toMatchObject({
      assignmentType: 'branch', assignmentId: secondBranch.id, status: 'active',
    });
    expect((await database.select().from(devices).where(eq(devices.id, firstDevice.id)).limit(1))[0]?.installationMarkerHash).toBeNull();
  });
  it('keeps an already-active employee session alive when only the personal device is revoked', async () => {
    const branch = await branchesModule.service.create({ name: 'Session exception', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const employee = await employeesModule.service.create({ fullName: 'Employee', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'Cairo', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    const pairing = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id });
    const active = await complete(pairing.pairingToken, 'session-exception');
    const token = 'active-device-revocation-session';
    await database.insert(authSessions).values({ id: 'active-self-service', tokenHash: createHash('sha256').update(token).digest('hex'), actorType: 'employee', employeeId: employee.id, createdAt: new Date(), revokedAt: null });

    await module.service.revoke(active.id);

    expect((await database.select().from(authSessions).where(eq(authSessions.id, 'active-self-service')).limit(1))[0]?.revokedAt).toBeNull();
    await expect(createAuthModule({
      database,
      attendance: { hasOpenSession: async () => true },
    }).service.authenticate(token)).resolves.toMatchObject({
      actorType: 'employee', employeeId: employee.id, revokedAt: null,
    });
  });
  it('rejects browser-profile reuse across assignments', async () => {
    const branch = await branchesModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const pairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id }); await complete(pairing.pairingToken, 'same');
    const employee = await employeesModule.service.create({ fullName: 'موظف', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'القاهرة', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    const other = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id });
    await expect(module.service.completePairing(other.pairingToken, { installationMarker: 'marker-same'.padEnd(16, 'x'), browser: 'Chrome', platform: 'Android' })).rejects.toMatchObject({ code: 'DEVICE_ALREADY_REGISTERED' });
  });
  it('revokes the employee device and cancels pending pairing on employee deletion', async () => {
    const branch = await branchesModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const employee = await employeesModule.service.create({ fullName: 'موظف', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'القاهرة', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    const pairing = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id }); const active = await complete(pairing.pairingToken, 'employee'); const pending = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id });
    await employeesModule.service.remove(employee.id);
    expect((await module.service.get(active.id)).status).toBe('revoked');
    await expect(complete(pending.pairingToken, 'replacement')).rejects.toMatchObject({ code: 'DEVICE_PAIRING_INVALID' });
    const actions = (await database.select({ action: auditEvents.action }).from(auditEvents)
      .where(eq(auditEvents.module, 'devices'))).map(({ action }) => action);
    expect(actions).toEqual(expect.arrayContaining(['revoke', 'pairing_cancel']));
  });
  it('records only devices revoked by employee lifecycle under a concurrent revocation', async () => {
    const branch = await branchesModule.service.create({ name: 'Concurrent revocation', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const employee = await employeesModule.service.create({ fullName: 'Employee', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'Cairo', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    const pairing = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id });
    const active = await complete(pairing.pairingToken, 'concurrent-revocation');
    const competingRevokedAt = new Date('2026-07-20T12:00:00.000Z');
    let releaseCompeting!: () => void;
    let markCompetingReady!: (connectionId: number) => void;
    const competingRelease = new Promise<void>((resolve) => { releaseCompeting = resolve; });
    const competingReady = new Promise<number>((resolve) => { markCompetingReady = resolve; });

    const competing = database.transaction(async (tx) => {
      const connectionResult = await tx.execute(sql`select connection_id() as connectionId`);
      const connectionId = Number((connectionResult[0] as unknown as Array<{ connectionId: number }>)[0]?.connectionId);
      await tx.select({ id: devices.id }).from(devices).where(eq(devices.id, active.id)).for('update').limit(1);
      await tx.update(devices).set({ status: 'revoked', revokedAt: competingRevokedAt }).where(eq(devices.id, active.id));
      await tx.insert(deviceHistory).values({ deviceId: active.id, event: 'revoked', createdAt: competingRevokedAt });
      markCompetingReady(connectionId);
      await competingRelease;
    });

    const competingConnectionId = await competingReady;
    const lifecycleRevocation = module.lifecycle.revokeEmployee(employee.id);
    const lockDeadline = Date.now() + 5_000;
    let lifecycleDeviceWaitObserved = false;
    while (!lifecycleDeviceWaitObserved && Date.now() < lockDeadline) {
      const lockWaitResult = await database.execute(sql`
        select exists(
          select 1
          from performance_schema.data_lock_waits waits
          join performance_schema.data_locks requested
            on requested.engine_lock_id = waits.requesting_engine_lock_id
          join information_schema.innodb_trx blocker
            on blocker.trx_id = waits.blocking_engine_transaction_id
          where requested.object_schema = database()
            and requested.object_name = 'devices'
            and blocker.trx_mysql_thread_id = ${competingConnectionId}
        ) as waiting
      `);
      lifecycleDeviceWaitObserved = Number((lockWaitResult[0] as unknown as Array<{ waiting: number }>)[0]?.waiting) === 1;
      if (!lifecycleDeviceWaitObserved) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    releaseCompeting();
    await Promise.all([competing, lifecycleRevocation]);
    expect(lifecycleDeviceWaitObserved).toBe(true);

    const history = await database.select().from(deviceHistory).where(and(
      eq(deviceHistory.deviceId, active.id),
      eq(deviceHistory.event, 'revoked'),
    ));
    expect(history).toHaveLength(1);
    const lifecycleAudits = await database.select().from(auditEvents).where(and(
      eq(auditEvents.module, 'devices'),
      eq(auditEvents.action, 'revoke'),
      eq(auditEvents.entityId, String(active.id)),
    ));
    expect(lifecycleAudits).toHaveLength(0);
  });
  it('silently verifies the registered browser marker repeatedly', async () => {
    const branch = await branchesModule.service.create({ name: 'Auth branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const pairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    const active = await complete(pairing.pairingToken, 'auth-device');
    const installationMarker = 'marker-auth-device'.padEnd(16, 'x');

    await expect(module.service.verify({ assignmentType: 'branch', assignmentId: branch.id }, installationMarker)).resolves.toMatchObject({ id: active.id });
    await expect(module.service.verify({ assignmentType: 'branch', assignmentId: branch.id }, installationMarker)).resolves.toMatchObject({ id: active.id });
    expect((await database.select().from(devices).where(eq(devices.id, active.id)).limit(1))[0]?.lastUsedAt).toBeInstanceOf(Date);
    const actions = (await database.select({ action: auditEvents.action }).from(auditEvents)
      .where(eq(auditEvents.module, 'devices'))).map(({ action }) => action);
    expect(actions.filter((action) => action === 'verify')).toHaveLength(2);
  });
  it('rejects a wrong marker without disabling the registered browser marker', async () => {
    const branch = await branchesModule.service.create({ name: 'Marker branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const pairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id });
    const active = await complete(pairing.pairingToken, 'marker-device');
    const installationMarker = 'marker-marker-device'.padEnd(16, 'x');

    await expect(module.service.verify(
      { assignmentType: 'branch', assignmentId: branch.id },
      'wrong-marker-value',
    )).rejects.toMatchObject({ code: 'DEVICE_INVALID' });
    await expect(module.service.verify(
      { assignmentType: 'branch', assignmentId: branch.id },
      installationMarker,
    )).resolves.toMatchObject({ id: active.id });
  });
  it('rejects creating a pairing when the employee became deleted before the locked write', async () => {
    const branch = await branchesModule.service.create({ name: 'Branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const employee = await employeesModule.service.create({ fullName: 'Employee', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'Cairo', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    await database.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));

    await expect(createDrizzleDeviceRepository(database).createPairing({ assignmentType: 'employee', assignmentId: employee.id, tokenHash: 'deleted-employee-token' })).resolves.toBe('assignment_not_found');
    expect(await database.select().from(devicePairingRequests)).toHaveLength(0);
  });
  it('invalidates a pending pairing when its employee was soft-deleted', async () => {
    const branch = await branchesModule.service.create({ name: 'Branch', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const employee = await employeesModule.service.create({ fullName: 'Employee', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'Cairo', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    const pairing = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id });
    await database.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));

    await expect(complete(pairing.pairingToken, 'deleted')).rejects.toMatchObject({ code: 'DEVICE_PAIRING_INVALID' });
    expect(await database.select().from(devices)).toHaveLength(0);
  });
});

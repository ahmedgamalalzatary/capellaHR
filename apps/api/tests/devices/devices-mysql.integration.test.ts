import { createDatabase } from '@capella/database';
import { authSessions, branches, deviceHistory, devicePairingRequests, devices, employeeCodeSequence, employeeImages, employeePhoneReservations, employees } from '@capella/database/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDevicesModule } from '../../src/modules/devices/index.js';
import { createEmployeesModule } from '../../src/modules/employees/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? ''); const module = createDevicesModule(database); const branchesModule = createBranchesModule(database); const employeesModule = createEmployeesModule(database, { hasOpenSession: async () => false }, undefined, module.lifecycle);
beforeEach(async () => { await database.delete(deviceHistory); await database.delete(devices); await database.delete(devicePairingRequests); await database.delete(authSessions); await database.delete(employeeImages); await database.delete(employeePhoneReservations); await database.delete(employees); await database.delete(employeeCodeSequence); await database.delete(branches); });
const complete = (token: string, marker: string) => module.service.completePairing(token, { credentialId: `credential-${marker}`, publicKey: `key-${marker}`, installationMarker: marker, browser: 'Chrome', platform: 'Android' });

describe('MySQL-backed devices', () => {
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
  it('rejects browser-profile reuse across assignments', async () => {
    const branch = await branchesModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const pairing = await module.service.createPairing({ assignmentType: 'branch', assignmentId: branch.id }); await complete(pairing.pairingToken, 'same');
    const employee = await employeesModule.service.create({ fullName: 'موظف', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'القاهرة', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    const other = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id });
    await expect(module.service.completePairing(other.pairingToken, { credentialId: 'other', publicKey: 'key', installationMarker: 'same', browser: 'Chrome', platform: 'Android' })).rejects.toMatchObject({ code: 'DEVICE_ALREADY_REGISTERED' });
  });
  it('revokes the employee device and cancels pending pairing on employee deletion', async () => {
    const branch = await branchesModule.service.create({ name: 'فرع', location: 'القاهرة', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50 });
    const employee = await employeesModule.service.create({ fullName: 'موظف', personalPhone: '01012345678', whatsappPhone: '01012345678', pin: '1234', age: 30, address: 'القاهرة', branchId: branch.id, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00', images: { personal: { storagePath: 'p', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idFront: { storagePath: 'f', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, idBack: { storagePath: 'b', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 } } });
    const pairing = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id }); const active = await complete(pairing.pairingToken, 'employee'); const pending = await module.service.createPairing({ assignmentType: 'employee', assignmentId: employee.id });
    await employeesModule.service.remove(employee.id);
    expect((await module.service.get(active.id)).status).toBe('revoked');
    await expect(complete(pending.pairingToken, 'replacement')).rejects.toMatchObject({ code: 'DEVICE_PAIRING_INVALID' });
  });
});

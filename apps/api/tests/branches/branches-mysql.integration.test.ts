import { createDatabase } from '@capella/database';
import { authSessions, branches, deviceHistory, devicePairingRequests, devices, employeeCodeSequence, employeeImages, employeePhoneReservations, employees } from '@capella/database/schema';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBranchesModule } from '../../src/modules/branches/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const module = createBranchesModule(database);
const input = {
  name: 'Cairo', location: 'Nasr City', latitude: 30, longitude: 31,
  gpsAccuracyMeters: 5, attendanceRadiusMeters: 50,
};

beforeEach(async () => {
  await database.delete(deviceHistory); await database.delete(devices); await database.delete(devicePairingRequests);
  await database.delete(authSessions); await database.delete(employeeImages); await database.delete(employeePhoneReservations);
  await database.delete(employees); await database.delete(employeeCodeSequence); await database.delete(branches);
});

describe('MySQL-backed branches', () => {
  it('persists, searches, updates, and deletes a never-referenced branch', async () => {
    const created = await module.service.create(input);
    expect((await module.service.list({ search: 'Nasr', page: 1, pageSize: 20 })).total).toBe(1);
    expect((await module.service.update(created.id, { attendanceRadiusMeters: 75 })).attendanceRadiusMeters).toBe(75);
    await module.service.remove(created.id);
    await expect(module.service.get(created.id)).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
  });

  it('enforces normalized uniqueness and the permanent reference lock', async () => {
    const created = await module.service.create(input);
    await expect(module.service.create({ ...input, name: '  CAIRO ' })).rejects.toMatchObject({ code: 'BRANCH_NAME_EXISTS' });
    expect(await module.service.markReferenced(created.id)).toBe(true);
    await expect(module.service.remove(created.id)).rejects.toMatchObject({ code: 'BRANCH_REFERENCED' });
  });
});

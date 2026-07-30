import { describe, expect, it } from 'vitest';

import { createErpAuthCapability } from '../../src/modules/auth/index.js';
import { createErpBranchCapability } from '../../src/modules/branches/index.js';
import { createErpEmployeeCapability } from '../../src/modules/employees/index.js';

describe('public HR capabilities for ERP', () => {
  it('exposes only an authenticated Admin or Cashier account identity', async () => {
    const capability = createErpAuthCapability({
      authenticate: async (token: string) => token === 'admin'
        ? {
            actorType: 'account' as const,
            accountId: 2,
            accountRole: 'admin' as const,
            employeeId: null,
          }
        : token === 'cashier'
          ? {
              actorType: 'account' as const,
              accountId: 3,
              accountRole: 'cashier' as const,
              employeeId: 7,
            }
          : token === 'employee'
            ? {
                actorType: 'employee' as const,
                accountId: null,
                accountRole: null,
                employeeId: 7,
              }
            : null,
    });

    await expect(capability.authenticateAccount('admin')).resolves.toEqual({
      role: 'admin',
      accountId: 2,
    });
    await expect(capability.authenticateAccount('cashier')).resolves.toEqual({
      role: 'cashier',
      accountId: 3,
      employeeId: 7,
    });
    await expect(capability.authenticateAccount('employee')).resolves.toBeNull();
    await expect(capability.authenticateAccount('missing')).resolves.toBeNull();
  });

  it('projects only safe branch identity fields', async () => {
    const capability = createErpBranchCapability({
      findById: async (id: number) => ({
        id,
        name: 'Downtown',
        nameNormalized: 'secret-normalized-key',
        location: 'Private internal details',
        latitude: 30,
        longitude: 31,
        gpsAccuracyMeters: 4,
        attendanceRadiusMeters: 100,
        hasEverBeenReferenced: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    });

    await expect(capability.findById(3)).resolves.toEqual({ id: 3, name: 'Downtown' });
  });

  it('projects only safe active employee identity fields', async () => {
    const capability = createErpEmployeeCapability({
      findActiveById: async (id: number) => ({
        id,
        employeeCode: 42,
        fullName: 'Employee',
        branchId: 3,
        employmentStatus: 'active' as const,
        deletedAt: null,
        pinHash: 'must-not-leak',
      }),
    });

    await expect(capability.findActiveById(7)).resolves.toEqual({
      id: 7,
      employeeCode: 42,
      fullName: 'Employee',
      branchId: 3,
    });
  });

  it('does not expose inactive or deleted employees', async () => {
    const inactive = createErpEmployeeCapability({
      findActiveById: async () => ({
        id: 7,
        employeeCode: 42,
        fullName: 'Employee',
        branchId: 3,
        employmentStatus: 'inactive' as const,
        deletedAt: null,
      }),
    });
    const deleted = createErpEmployeeCapability({
      findActiveById: async () => ({
        id: 7,
        employeeCode: 42,
        fullName: 'Employee',
        branchId: 3,
        employmentStatus: 'active' as const,
        deletedAt: new Date(),
      }),
    });

    await expect(inactive.findActiveById(7)).resolves.toBeNull();
    await expect(deleted.findActiveById(7)).resolves.toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createErpAttendanceCapability } from '../../src/modules/attendance/index.js';

/**
 * The ERP may only ever see who is on the floor. Everything else an attendance
 * row carries — devices, GPS, PIN state, session ids — stays inside HR.
 */
const readerRow = {
  id: 7,
  employeeCode: 42,
  fullName: 'موظف الحضور',
  branchId: 3,
  sessionId: 91,
  checkInAt: new Date('2026-08-02T06:00:00.000Z'),
  deviceId: 12,
  pinHash: 'must-not-leak',
};

describe('ERP attendance capability', () => {
  it('projects only safe present-employee identity fields', async () => {
    const capability = createErpAttendanceCapability({
      listPresentEmployees: async () => [readerRow],
      findPresentEmployee: async () => readerRow,
    });

    await expect(capability.listPresentEmployees(3)).resolves.toEqual([
      { id: 7, employeeCode: 42, fullName: 'موظف الحضور', branchId: 3 },
    ]);
  });

  it('projects a single presence re-check to the same safe fields', async () => {
    const capability = createErpAttendanceCapability({
      listPresentEmployees: async () => [readerRow],
      findPresentEmployee: async () => readerRow,
    });

    await expect(capability.findPresentEmployee(3, 7)).resolves.toEqual({
      id: 7, employeeCode: 42, fullName: 'موظف الحضور', branchId: 3,
    });
  });

  it('reports an employee who is not on the floor as absent', async () => {
    const capability = createErpAttendanceCapability({
      listPresentEmployees: async () => [],
      findPresentEmployee: async () => null,
    });

    await expect(capability.findPresentEmployee(3, 7)).resolves.toBeNull();
  });

  it('forwards a caller transaction so a completing sale re-checks inside it', async () => {
    const findPresentEmployee = vi.fn(async () => readerRow);
    const capability = createErpAttendanceCapability({
      listPresentEmployees: async () => [readerRow],
      findPresentEmployee,
    });
    const transaction = Symbol('sale transaction');

    await capability.findPresentEmployee(3, 7, transaction);

    expect(findPresentEmployee).toHaveBeenCalledWith(3, 7, transaction);
  });
});

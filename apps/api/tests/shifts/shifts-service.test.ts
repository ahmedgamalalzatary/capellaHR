/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import {
  createShiftService,
  type ShiftAssignmentRecord,
  type ShiftRepository,
} from '../../src/modules/shifts/index.js';

const assignment: ShiftAssignmentRecord = {
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'موظف تجريبي',
  branchId: 3,
  branchName: 'فرع القاهرة',
  durationMinutes: 600,
};

const makeRepository = (): ShiftRepository => ({
  findByEmployeeId: vi.fn(async () => assignment),
  list: vi.fn(async () => ({ items: [assignment], total: 1 })),
  updateDuration: vi.fn(async () => assignment),
  lockDurationForCheckIn: vi.fn(async () => assignment.durationMinutes),
});

describe('shift service', () => {
  it('gets an active employee shift assignment', async () => {
    await expect(createShiftService(makeRepository()).getByEmployee(7)).resolves.toEqual(assignment);
  });

  it('rejects an unknown or deleted employee assignment', async () => {
    const repository = makeRepository();
    const findByEmployeeId = vi.mocked(repository.findByEmployeeId);
    findByEmployeeId.mockResolvedValue(null);

    await expect(createShiftService(repository).getByEmployee(7)).rejects.toMatchObject({
      code: 'SHIFT_ASSIGNMENT_NOT_FOUND',
    });
  });

  it('delegates list filters without changing them', async () => {
    const repository = makeRepository();
    const query = { search: '42', branchId: 3, page: 2, pageSize: 25 };

    await createShiftService(repository).list(query);

    expect(vi.mocked(repository.list)).toHaveBeenCalledWith(query);
  });

  it('updates the duration through one atomic repository operation', async () => {
    const repository = makeRepository();

    await createShiftService(repository).updateByEmployee(7, { durationMinutes: 480 });

    expect(vi.mocked(repository.updateDuration)).toHaveBeenCalledOnce();
    expect(vi.mocked(repository.updateDuration)).toHaveBeenCalledWith(7, 480);
    expect(vi.mocked(repository.findByEmployeeId)).not.toHaveBeenCalled();
  });

  it('rejects an update when the employee is unknown or deleted', async () => {
    const repository = makeRepository();
    const updateDuration = vi.mocked(repository.updateDuration);
    updateDuration.mockResolvedValue(null);

    await expect(createShiftService(repository).updateByEmployee(7, {
      durationMinutes: 480,
    })).rejects.toMatchObject({ code: 'SHIFT_ASSIGNMENT_NOT_FOUND' });
  });

  it('reads the check-in snapshot through the caller transaction', async () => {
    const repository = makeRepository();
    const transaction = { transaction: true };

    await expect(createShiftService(repository).readRequiredDurationForCheckIn(
      7,
      transaction,
    )).resolves.toBe(600);

    expect(vi.mocked(repository.lockDurationForCheckIn)).toHaveBeenCalledWith(7, transaction, false);
  });

  it('rejects snapshot capture for an unknown or deleted employee', async () => {
    const repository = makeRepository();
    vi.mocked(repository.lockDurationForCheckIn).mockResolvedValue(null);

    await expect(createShiftService(repository).readRequiredDurationForCheckIn(
      7,
      {},
    )).rejects.toMatchObject({ code: 'SHIFT_ASSIGNMENT_NOT_FOUND' });
  });
});

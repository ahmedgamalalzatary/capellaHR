/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return */
import { verify } from 'argon2';
import { describe, expect, it, vi } from 'vitest';

import { createEmployeeService, EmployeeError, type EmployeeRepository } from '../../src/modules/employees/employees-service.js';

const input = {
  fullName: ' أحمد ', personalPhone: '01012345678', whatsappPhone: '01112345678', pin: '1234',
  age: 30, address: ' القاهرة ', branchId: 1, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00',
  images: {
    personal: { storagePath: 'employees/a.jpg', mimeType: 'image/jpeg', sizeBytes: 10, originalName: 'a.jpg' },
    idFront: { storagePath: 'employees/b.jpg', mimeType: 'image/jpeg', sizeBytes: 10, originalName: 'b.jpg' },
    idBack: { storagePath: 'employees/c.jpg', mimeType: 'image/jpeg', sizeBytes: 10, originalName: 'c.jpg' },
  },
};

const repository = (): EmployeeRepository => ({
  create: vi.fn(async (value) => ({ id: 1, employeeCode: 1, credentialVersion: 1, ...value, pinHash: value.pinHash, deletedAt: null, createdAt: new Date(), updatedAt: new Date() })),
  findActiveById: vi.fn(), findIdentityByCode: vi.fn(), list: vi.fn(), update: vi.fn(), softDeleteIfAttendanceClosed: vi.fn(),
  findPhoneOwner: vi.fn(), branchExists: vi.fn(async () => true),
});

describe('employee service', () => {
  it('hashes the PIN, trims text, and never returns the PIN hash', async () => {
    const repo = repository();
    const employee = await createEmployeeService(repo).create(input);
    const stored = vi.mocked(repo.create).mock.calls[0]![0];
    expect(await verify(stored.pinHash, '1234')).toBe(true);
    expect(employee).not.toHaveProperty('pinHash');
    expect(employee).not.toHaveProperty('pin');
    expect(employee.fullName).toBe('أحمد');
  });

  it.each(['personalPhone', 'whatsappPhone'] as const)('rejects a conflicting %s', async (field) => {
    const repo = repository();
    vi.mocked(repo.findPhoneOwner).mockImplementation(async (phone) => phone === input[field] ? { id: 9 } : null);
    await expect(createEmployeeService(repo).create(input)).rejects.toMatchObject({ code: 'EMPLOYEE_PHONE_EXISTS' });
    expect(repo.findPhoneOwner).toHaveBeenCalledWith(input[field]);
  });

  it('rejects an unknown branch', async () => {
    const repo = repository(); vi.mocked(repo.branchExists).mockResolvedValue(false);
    await expect(createEmployeeService(repo).create(input)).rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_FOUND' } satisfies Partial<EmployeeError>);
  });

  it('requests atomic session revocation with a changed PIN', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, value) => ({ record: { id: 1, employeeCode: 1, credentialVersion: 1, fullName: 'x', personalPhone: '01012345678', whatsappPhone: '01112345678', age: 1, address: 'x', branchId: 1, shiftDurationMinutes: 1, monthlyBaseSalary: '1.00', images: input.images, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...value }, replacedImages: {} } as never));
    await createEmployeeService(repo, { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) }).update(1, { pin: '4321' });
    expect(await verify(vi.mocked(repo.update).mock.calls[0]![1].pinHash!, '4321')).toBe(true);
    expect(vi.mocked(repo.update).mock.calls[0]![2]).toBe(true);
  });

  it('requests an atomic attendance check when changing branch', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 1 } as never);
    vi.mocked(repo.update).mockResolvedValue({ record: { id: 1, branchId: 2 } as never, replacedImages: {} });
    const attendance = { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) };

    await createEmployeeService(repo, attendance).update(1, { branchId: 2 });

    expect(repo.update).toHaveBeenCalledWith(1, { branchId: 2 }, false, expect.any(Function));
    const check = vi.mocked(repo.update).mock.calls[0]![3]!;
    const context = { transaction: true };
    await check(1, context);
    expect(attendance.hasAnyOpenSession).toHaveBeenCalledWith(1, context);
  });

  it('passes the transfer guard whenever branchId is submitted so the locked row decides', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 2 } as never);
    vi.mocked(repo.update).mockResolvedValue({ record: { id: 1, branchId: 2 } as never, replacedImages: {} });

    await createEmployeeService(repo, { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) }).update(1, { branchId: 2 });

    expect(vi.mocked(repo.update).mock.calls[0]![3]).toEqual(expect.any(Function));
  });

  it('rejects branch reassignment while the employee is checked in', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 1 } as never);
    vi.mocked(repo.update).mockImplementation(async (id, _changes, _revoke, hasOpenSession) => (
      await hasOpenSession!(id, {}) ? 'checked_in' : null
    ));
    const attendance = {
      hasOpenSession: vi.fn(async () => false),
      hasAnyOpenSession: vi.fn(async () => true),
    };

    await expect(createEmployeeService(repo, attendance)
      .update(1, { branchId: 2 }))
      .rejects.toMatchObject({ code: 'EMPLOYEE_CHECKED_IN' });
    expect(attendance.hasAnyOpenSession).toHaveBeenCalledWith(1, expect.anything());
    expect(attendance.hasOpenSession).not.toHaveBeenCalled();
  });

  it('rejects reassignment to an unknown branch', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 1 } as never);
    vi.mocked(repo.update).mockResolvedValue('branch_not_found');

    await expect(createEmployeeService(repo, { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) })
      .update(1, { branchId: 2 }))
      .rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_FOUND' });
  });

  it('fails closed when attendance state is unavailable for deletion', async () => {
    const repo = repository(); vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1 } as never);
    await expect(createEmployeeService(repo).remove(1)).rejects.toMatchObject({ code: 'EMPLOYEE_ATTENDANCE_UNAVAILABLE' });
  });

  it('checks attendance and soft deletes through one atomic repository operation', async () => {
    const repo = repository();
    const attendance = { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) };
    vi.mocked(repo.softDeleteIfAttendanceClosed).mockResolvedValue('deleted');

    await createEmployeeService(repo, attendance).remove(1);

    expect(repo.softDeleteIfAttendanceClosed).toHaveBeenCalledWith(1, true, expect.any(Function));
    const atomicAttendanceCheck = vi.mocked(repo.softDeleteIfAttendanceClosed).mock.calls[0]![2];
    const context = { transaction: true };
    await atomicAttendanceCheck(1, context);
    expect(attendance.hasOpenSession).toHaveBeenCalledWith(1, context);
    expect(repo.findActiveById).not.toHaveBeenCalled();
  });

  it('runs advance acceleration inside the atomic employee deletion transaction', async () => {
    const repo = repository();
    const attendance = { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) };
    const financialLifecycle = { prepareEmployeeDeletion: vi.fn(async () => undefined) };
    vi.mocked(repo.softDeleteIfAttendanceClosed).mockResolvedValue('deleted');

    await createEmployeeService(repo, attendance, undefined, financialLifecycle).remove(1);

    expect(repo.softDeleteIfAttendanceClosed).toHaveBeenCalledWith(
      1, true, expect.any(Function), undefined, expect.any(Function),
    );
    const prepareDeletion = vi.mocked(repo.softDeleteIfAttendanceClosed).mock.calls[0]![4]!;
    const context = { transaction: true };
    const deletedAt = new Date('2026-07-31T21:00:00.000Z');
    await prepareDeletion(1, deletedAt, context);
    expect(financialLifecycle.prepareEmployeeDeletion).toHaveBeenCalledWith(1, deletedAt, context);
  });
});

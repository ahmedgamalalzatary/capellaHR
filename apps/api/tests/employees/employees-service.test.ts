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
  findActiveById: vi.fn(), findIdentityByCode: vi.fn(), list: vi.fn(), update: vi.fn(), softDelete: vi.fn(),
  findPhoneOwner: vi.fn(), branchExists: vi.fn(async () => true),
});

describe('employee service', () => {
  it('hashes the PIN, trims text, and never returns the PIN hash', async () => {
    const repo = repository();
    const employee = await createEmployeeService(repo).create(input);
    const stored = vi.mocked(repo.create).mock.calls[0]![0];
    expect(await verify(stored.pinHash, '1234')).toBe(true);
    expect(employee).not.toHaveProperty('pinHash');
    expect(employee.fullName).toBe('أحمد');
  });

  it('rejects a number owned by another employee across either phone field', async () => {
    const repo = repository();
    vi.mocked(repo.findPhoneOwner).mockResolvedValue({ id: 9 });
    await expect(createEmployeeService(repo).create(input)).rejects.toMatchObject({ code: 'EMPLOYEE_PHONE_EXISTS' });
  });

  it('rejects an unknown branch', async () => {
    const repo = repository(); vi.mocked(repo.branchExists).mockResolvedValue(false);
    await expect(createEmployeeService(repo).create(input)).rejects.toEqual(expect.any(EmployeeError));
  });

  it('requests atomic session revocation with a changed PIN', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, value) => ({ record: { id: 1, employeeCode: 1, credentialVersion: 1, fullName: 'x', personalPhone: '01012345678', whatsappPhone: '01112345678', age: 1, address: 'x', branchId: 1, shiftDurationMinutes: 1, monthlyBaseSalary: '1.00', images: input.images, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...value }, replacedImages: {} } as never));
    await createEmployeeService(repo, { hasOpenSession: vi.fn(async () => false) }).update(1, { pin: '4321' });
    expect(await verify(vi.mocked(repo.update).mock.calls[0]![1].pinHash!, '4321')).toBe(true);
    expect(vi.mocked(repo.update).mock.calls[0]![2]).toBe(true);
  });

  it('fails closed when attendance state is unavailable for deletion', async () => {
    const repo = repository(); vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1 } as never);
    await expect(createEmployeeService(repo).remove(1)).rejects.toMatchObject({ code: 'EMPLOYEE_ATTENDANCE_UNAVAILABLE' });
  });
});

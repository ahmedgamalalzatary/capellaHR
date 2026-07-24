/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import { createAdvanceService, type AdvanceRepository } from '../../src/modules/advances/index.js';

const input = { employeeId: 3, amount: '100.00', installmentCount: 3, startMonth: '2026-07' };
const record = { id: 1, ...input, employeeCode: 9, employeeName: 'موظف', branchId: 2, branchName: 'فرع', employeeDeletedAt: null, installments: [], createdAt: new Date(), updatedAt: new Date() };
const repo = (): AdvanceRepository => ({
  create: vi.fn(async () => ({ kind: 'success' as const, record })),
  findById: vi.fn(async () => record),
  list: vi.fn(async () => ({ items: [record], total: 1 })),
  update: vi.fn(async () => ({ kind: 'success' as const, record })),
  remove: vi.fn(async () => ({ kind: 'success' as const })),
  accelerateForDeletion: vi.fn(async () => undefined),
  deactivationImpact: vi.fn(async () => ({ unpaidInstallmentCount: 0, unpaidAdvanceAmount: '0.00', currentMonthAdvanceAmount: '0.00' })),
  settleDeactivationPayment: vi.fn(async () => undefined),
});

describe('advance service', () => {
  it('creates an advance with a generated consecutive schedule', async () => {
    await expect(createAdvanceService(repo()).create(input)).resolves.toEqual(record);
  });

  it.each([
    ['employee_not_found', 'ADVANCE_EMPLOYEE_NOT_FOUND'],
    ['employee_deleted', 'ADVANCE_EMPLOYEE_DELETED'],
    ['ineligible_month', 'ADVANCE_MONTH_NOT_ELIGIBLE'],
    ['finalized', 'ADVANCE_PAYROLL_FINALIZED'],
  ] as const)('maps create result %s', async (kind, code) => {
    const repository = repo();
    vi.mocked(repository.create).mockResolvedValue({ kind });
    await expect(createAdvanceService(repository).create(input)).rejects.toMatchObject({ code });
  });

  it('returns a readable Arabic error message', async () => {
    const repository = repo();
    vi.mocked(repository.create).mockResolvedValue({ kind: 'employee_not_found' });
    await expect(createAdvanceService(repository).create(input)).rejects.toMatchObject({
      message: 'تعذر تنفيذ عملية السلفة',
    });
  });

  it('maps an invalid effective installment schedule without leaking a database error', async () => {
    const repository = repo();
    vi.mocked(repository.update).mockResolvedValue({ kind: 'invalid_schedule' });
    await expect(createAdvanceService(repository).update(1, { installmentCount: 4 }))
      .rejects.toMatchObject({ code: 'ADVANCE_INVALID_SCHEDULE' });
  });
});

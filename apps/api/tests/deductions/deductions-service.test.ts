/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import { createDeductionService, type DeductionRepository } from '../../src/modules/deductions/index.js';

const input = { employeeId: 3, amount: '100.00', payrollMonth: '2026-07' };
const record = { id: 1, ...input, employeeCode: 9, employeeName: 'موظف', branchId: 2, branchName: 'فرع', employeeDeletedAt: null, createdAt: new Date(), updatedAt: new Date() };
const repo = (): DeductionRepository => ({
  create: vi.fn(async () => ({ kind: 'success' as const, record })),
  findById: vi.fn(async () => record),
  list: vi.fn(async () => ({ items: [record], total: 1 })),
  update: vi.fn(async () => ({ kind: 'success' as const, record })),
  remove: vi.fn(async () => ({ kind: 'success' as const })),
});

describe('deduction service', () => {
  it('creates positive manual deductions that payroll will subtract', async () => {
    await expect(createDeductionService(repo()).create(input)).resolves.toEqual(record);
  });

  it.each([
    ['employee_not_found', 'DEDUCTION_EMPLOYEE_NOT_FOUND'],
    ['employee_deleted', 'DEDUCTION_EMPLOYEE_DELETED'],
    ['future_month', 'DEDUCTION_FUTURE_MONTH'],
    ['ineligible_month', 'DEDUCTION_MONTH_NOT_ELIGIBLE'],
    ['finalized', 'DEDUCTION_PAYROLL_FINALIZED'],
  ] as const)('maps create result %s', async (kind, code) => {
    const repository = repo();
    vi.mocked(repository.create).mockResolvedValue({ kind });
    await expect(createDeductionService(repository).create(input)).rejects.toMatchObject({ code });
  });
});

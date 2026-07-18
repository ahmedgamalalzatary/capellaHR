/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import { createBonusService, type BonusRepository } from '../../src/modules/bonuses/index.js';

const input = { employeeId: 3, amount: '100.00', payrollMonth: '2026-07' };
const record = { id: 1, ...input, employeeCode: 9, employeeName: 'موظف', branchId: 2, branchName: 'فرع', employeeDeletedAt: null, createdAt: new Date(), updatedAt: new Date() };
const repo = (): BonusRepository => ({
  create: vi.fn(async () => ({ kind: 'success' as const, record })),
  findById: vi.fn(async () => record),
  list: vi.fn(async () => ({ items: [record], total: 1 })),
  update: vi.fn(async () => ({ kind: 'success' as const, record })),
  remove: vi.fn(async () => ({ kind: 'success' as const })),
});

describe('bonus service', () => {
  it('creates and lists fixed employee-month bonuses', async () => {
    const service = createBonusService(repo());
    await expect(service.create(input)).resolves.toEqual(record);
    await expect(service.list({ page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 1 });
  });

  it.each([
    ['employee_not_found', 'BONUS_EMPLOYEE_NOT_FOUND'],
    ['employee_deleted', 'BONUS_EMPLOYEE_DELETED'],
    ['future_month', 'BONUS_FUTURE_MONTH'],
    ['ineligible_month', 'BONUS_MONTH_NOT_ELIGIBLE'],
    ['finalized', 'BONUS_PAYROLL_FINALIZED'],
  ] as const)('maps create result %s', async (kind, code) => {
    const repository = repo();
    vi.mocked(repository.create).mockResolvedValue({ kind });
    await expect(createBonusService(repository).create(input)).rejects.toMatchObject({ code });
  });

  it('returns a readable Arabic error message', async () => {
    const repository = repo();
    vi.mocked(repository.create).mockResolvedValue({ kind: 'employee_not_found' });
    await expect(createBonusService(repository).create(input)).rejects.toMatchObject({
      message: 'تعذر تنفيذ عملية الراتب',
    });
  });
});

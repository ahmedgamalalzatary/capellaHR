import { describe, expect, it, vi } from 'vitest';

import { createExpenseService, type ExpenseRecord, type ExpenseRepository } from '../../src/modules/erp/expenses/expense-service.js';

const admin = { accountId: 7, role: 'admin' as const, employeeId: null };
const cashier = { accountId: 8, role: 'cashier' as const, employeeId: 3 };
const record: ExpenseRecord = {
  id: 10, branchId: 2, categoryId: 4, categoryName: 'تشغيل', amount: '125.50', expenseDate: '2026-08-05',
  description: 'مستلزمات', actingAccountId: 7, actingUsername: 'admin', kind: 'expense', status: 'active',
  reversalOfId: null, supersedesId: null, correctionReason: null, createdAt: new Date('2026-08-05T10:00:00Z'),
};
const repository = (): ExpenseRepository => ({
  create: vi.fn().mockResolvedValue(record),
  findById: vi.fn().mockResolvedValue(record),
  list: vi.fn().mockResolvedValue({ items: [record], total: 1 }),
  correct: vi.fn().mockResolvedValue({ original: { ...record, status: 'corrected' }, reversal: { ...record, id: 11, kind: 'reversal', reversalOfId: 10 }, replacement: { ...record, id: 12, supersedesId: 10 } }),
});
const resolver = vi.fn().mockResolvedValue({ accountId: 7, branchId: 2 });

describe('expense service', () => {
  it('uses the resolved branch and acting account when an admin records an expense', async () => {
    const repo = repository();
    const service = createExpenseService({ repository: repo, resolveBranchContext: resolver });
    await service.create(admin, { branchId: 2, categoryId: 4, amount: '125.50', expenseDate: '2026-08-05', description: 'مستلزمات' });
    // The repository contract owns methods; the mock intentionally extracts one for call inspection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const create = vi.mocked(repo.create);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2, actingAccountId: 7 }));
  });

  it('lets a cashier record and read expenses under the branch resolved for the account', async () => {
    const repo = repository();
    const cashierScope = vi.fn().mockResolvedValue({ accountId: 8, branchId: 2 });
    const service = createExpenseService({ repository: repo, resolveBranchContext: cashierScope });

    await service.create(cashier, { categoryId: 4, amount: '1.00', expenseDate: '2026-08-05', description: 'x' });

    // The repository contract owns methods; the mock intentionally extracts one for call inspection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const create = vi.mocked(repo.create);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2, actingAccountId: 8 }));
    // The branch is never taken from the request body; the resolver decides it for a cashier.
    expect(cashierScope).toHaveBeenCalledWith(cashier, undefined);
    await expect(service.get(cashier, 10)).resolves.toMatchObject({ id: 10 });
    await expect(service.list(cashier, { page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 1 });
  });

  it('keeps correcting a recorded expense an admin-only action', async () => {
    const service = createExpenseService({ repository: repository(), resolveBranchContext: resolver });
    await expect(service.correct(cashier, 10, { branchId: 2, categoryId: 4, amount: '1.00', expenseDate: '2026-08-05', description: 'x', reason: 'x' })).rejects.toMatchObject({
      code: 'ERP_EXPENSE_ADMIN_REQUIRED',
      message: 'تصحيح المصروفات متاح للمدير فقط',
    });
  });

  it('hides another branch record as not found', async () => {
    const repo = repository();
    repo.findById = vi.fn().mockResolvedValue({ ...record, branchId: 9 });
    const service = createExpenseService({ repository: repo, resolveBranchContext: resolver });
    await expect(service.get(admin, 10, 2)).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND' });
    await expect(service.correct(admin, 10, { branchId: 2, categoryId: 4, amount: '1.00', expenseDate: '2026-08-05', description: 'x', reason: 'x' })).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND' });
  });

  it('rejects a non-expense, inactive, or cross-branch category with a stable error', async () => {
    const repo = repository();
    repo.create = vi.fn().mockResolvedValue('invalid-category');
    const service = createExpenseService({ repository: repo, resolveBranchContext: resolver });
    await expect(service.create(admin, { branchId: 2, categoryId: 4, amount: '1.00', expenseDate: '2026-08-05', description: 'x' })).rejects.toMatchObject({ code: 'EXPENSE_CATEGORY_INVALID' });
  });

  it('atomically corrects an active original and rejects a repeated correction', async () => {
    const repo = repository();
    const service = createExpenseService({ repository: repo, resolveBranchContext: resolver });
    await service.correct(admin, 10, { branchId: 2, categoryId: 4, amount: '100.00', expenseDate: '2026-08-05', description: 'الصحيح', reason: 'قيمة خاطئة' });
    // The repository contract owns methods; the mock intentionally extracts one for call inspection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const correct = vi.mocked(repo.correct);
    expect(correct).toHaveBeenCalledWith(10, expect.objectContaining({ branchId: 2, actingAccountId: 7, reason: 'قيمة خاطئة' }));
    repo.correct = vi.fn().mockResolvedValue('already-corrected');
    await expect(service.correct(admin, 10, { categoryId: 4, amount: '100.00', expenseDate: '2026-08-05', description: 'x', reason: 'x' })).rejects.toMatchObject({ code: 'EXPENSE_ALREADY_CORRECTED' });
  });

  it('maps invalid correction targets and category races to stable errors', async () => {
    const repo = repository();
    const service = createExpenseService({ repository: repo, resolveBranchContext: resolver });
    repo.correct = vi.fn().mockResolvedValueOnce('invalid-target').mockResolvedValueOnce('invalid-category');
    const input = { categoryId: 4, amount: '100.00', expenseDate: '2026-08-05', description: 'x', reason: 'x' };
    await expect(service.correct(admin, 11, input)).rejects.toMatchObject({
      code: 'EXPENSE_CORRECTION_TARGET_INVALID',
      message: 'لا يمكن تصحيح قيد عكسي',
    });
    await expect(service.correct(admin, 10, input)).rejects.toMatchObject({ code: 'EXPENSE_CATEGORY_INVALID' });
  });
});

import { describe, expect, it } from 'vitest';

import {
  correctExpenseSchema,
  createExpenseSchema,
  listExpensesQuerySchema,
} from '../../../../src/modules/erp/expenses/index.js';

const valid = {
  branchId: 2,
  categoryId: 4,
  amount: '125.50',
  expenseDate: '2026-08-05',
  description: 'مستلزمات نظافة',
};

describe('expense contracts', () => {
  it('normalizes exact positive EGP amounts and accepts a Cairo calendar date', () => {
    expect(createExpenseSchema.parse(valid)).toMatchObject({ amount: '125.50', expenseDate: '2026-08-05' });
    expect(createExpenseSchema.parse({ ...valid, amount: '001.5' }).amount).toBe('1.50');
  });

  it.each(['0', '-1', '1.001', 'NaN'])('rejects invalid amount %s', (amount) => {
    expect(createExpenseSchema.safeParse({ ...valid, amount }).success).toBe(false);
  });

  it.each(['0999-12-31', '2026-02-30', '2026-8-05', '2026-13-01'])('rejects invalid calendar date %s', (expenseDate) => {
    expect(createExpenseSchema.safeParse({ ...valid, expenseDate }).success).toBe(false);
  });

  it('requires a meaningful description', () => {
    expect(createExpenseSchema.safeParse({ ...valid, description: '   ' }).success).toBe(false);
  });

  it('validates correction input independently from the replacement expense', () => {
    expect(correctExpenseSchema.parse({ ...valid, reason: 'تم تسجيل القيمة بالخطأ' }).reason).toBe('تم تسجيل القيمة بالخطأ');
    expect(correctExpenseSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
  });

  it('parses branch, category, date, status and pagination filters', () => {
    expect(listExpensesQuerySchema.parse({ branchId: '2', categoryId: '4', fromDate: '2026-08-01', toDate: '2026-08-31', status: 'active' })).toMatchObject({ branchId: 2, categoryId: 4, page: 1, pageSize: 20 });
  });
});

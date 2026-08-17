import { describe, expect, it } from 'vitest';

import {
  correctExpenseSchema,
  createExpenseSchema,
  listExpensesQuerySchema,
} from '../../../../src/modules/erp/expenses/index.js';

const valid = {
  branchId: 2,
  name: 'مستلزمات نظافة',
  amount: '125.50',
  expenseDate: '2026-08-05',
  description: 'صابون ومناديل لفرع المعادي',
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

  it('identifies an expense by a required name and optional notes', () => {
    expect(createExpenseSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
    const withoutNotes = { ...valid };
    Reflect.deleteProperty(withoutNotes, 'description');
    expect(createExpenseSchema.parse(withoutNotes)).not.toHaveProperty('description');
    expect(createExpenseSchema.parse({ ...valid, name: '  كهرباء  ' }).name).toBe('كهرباء');
    // Blank notes are the same as none at all.
    expect(createExpenseSchema.parse({ ...valid, description: '   ' }).description).toBe('');
  });

  it('no longer accepts a category on an expense', () => {
    expect(createExpenseSchema.safeParse({ ...valid, categoryId: 4 }).success).toBe(false);
    expect(listExpensesQuerySchema.safeParse({ branchId: '2', categoryId: '4' }).success).toBe(false);
  });

  it('validates correction input independently from the replacement expense', () => {
    expect(correctExpenseSchema.parse({ ...valid, reason: 'تم تسجيل القيمة بالخطأ' }).reason).toBe('تم تسجيل القيمة بالخطأ');
    expect(correctExpenseSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
  });

  it('parses branch, search, date, status and pagination filters', () => {
    expect(listExpensesQuerySchema.parse({ branchId: '2', search: '  كهرباء  ', fromDate: '2026-08-01', toDate: '2026-08-31', status: 'active' })).toMatchObject({ branchId: 2, search: 'كهرباء', page: 1, pageSize: 20 });
  });
});

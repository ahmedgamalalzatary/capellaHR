import type { ListExpenseParams } from './api/expenses-api';
export const expenseQueryKeys = { all: ['expenses'] as const, list: (params: ListExpenseParams) => ['expenses', 'list', params] as const };
export const expenseCategoryQueryKeys = {
  all: ['expense-categories'] as const,
  active: (branchId: number | undefined) => ['expense-categories', branchId, 'active'] as const,
  forBranch: (branchId: number | undefined) => ['expense-categories', branchId, 'all'] as const,
};

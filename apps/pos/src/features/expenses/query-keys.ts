import type { ListExpenseParams } from './api/expenses-api';
export const expenseQueryKeys = { all: ['expenses'] as const, list: (params: ListExpenseParams) => ['expenses', 'list', params] as const };

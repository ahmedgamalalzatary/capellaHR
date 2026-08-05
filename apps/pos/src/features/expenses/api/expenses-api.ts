import type { CorrectExpenseInput, CreateExpenseInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

export type Expense = {
  id: number; branchId: number; categoryId: number; categoryName: string; amount: string;
  expenseDate: string; description: string; actingAccountId: number; actingUsername: string;
  kind: 'expense' | 'reversal'; status: 'active' | 'corrected'; reversalOfId: number | null;
  supersedesId: number | null; correctionReason: string | null; createdAt: string;
};
export type ExpenseCorrection = { original: Expense; reversal: Expense; replacement: Expense };
export type ListExpenseParams = { branchId?: number; categoryId?: number; fromDate?: string; toDate?: string; status?: 'active' | 'corrected'; page?: number; pageSize?: number };
const query = (params: Record<string, string | number | undefined>) => {
  const value = new URLSearchParams(); for (const [key, entry] of Object.entries(params)) if (entry !== undefined && entry !== '') value.set(key, String(entry));
  const serialized = value.toString(); return serialized ? `?${serialized}` : '';
};
export const listExpenses = (params: ListExpenseParams = {}) => api.getPage<Expense>(`/erp/expenses${query(params)}`);
export const getExpense = (id: number, branchId?: number) => api.get<Expense>(`/erp/expenses/${id}${query({ branchId })}`);
export const createExpense = (input: CreateExpenseInput) => api.post<Expense>('/erp/expenses', input);
export const correctExpense = (id: number, input: CorrectExpenseInput) => api.post<ExpenseCorrection>(`/erp/expenses/${id}/corrections`, input);

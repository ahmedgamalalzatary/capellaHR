import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listDeductions: vi.fn(),
  createDeduction: vi.fn(),
  updateDeduction: vi.fn(),
  deleteDeduction: vi.fn(),
  listEmployees: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/deductions/api/deductions-api', () => ({
  listDeductions: mocks.listDeductions,
  createDeduction: mocks.createDeduction,
  updateDeduction: mocks.updateDeduction,
  deleteDeduction: mocks.deleteDeduction,
}));

vi.mock('../src/features/employees/api/employees-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listEmployees: mocks.listEmployees,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { DeductionsView } from '../src/features/deductions/components/deductions-view';

const deduction = {
  id: 9,
  employeeId: 1,
  employeeCode: 1001,
  employeeName: 'أحمد جمال',
  branchId: 3,
  branchName: 'فرع القاهرة',
  payrollMonth: '2026-06',
  amount: '75.00',
  employeeDeletedAt: null,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeductionsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listDeductions.mockResolvedValue(pageOf([deduction]));
  mocks.listEmployees.mockResolvedValue(
    pageOf([{ id: 1, employeeCode: 1001, fullName: 'أحمد جمال' }]),
  );
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeductionsView', () => {
  test('lists deductions from the deductions endpoint with the amount', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(row.textContent).toContain('75.00');
    expect(mocks.listDeductions).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  test('creates a deduction through the deductions endpoint', async () => {
    mocks.createDeduction.mockResolvedValue(deduction);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة خصم' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText(/شهر الراتب/), { target: { value: '2026-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(mocks.createDeduction).toHaveBeenCalledWith({
        employeeId: 1,
        amount: '75',
        payrollMonth: '2026-06',
      }),
    );
  });

  test('shows the deductions empty state', async () => {
    mocks.listDeductions.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد خصومات')).toBeDefined();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  reason: 'Late arrival',
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
    expect(row.textContent).toContain('Late arrival');
    expect(mocks.listDeductions).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  test('opens the create form in a dialog instead of inline', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إضافة خصم' }));
    const dialog = await screen.findByRole('dialog', { name: 'خصم جديد' });
    expect(dialog.className.split(/\s+/)).toContain('max-w-xl');
    expect(within(dialog).getByLabelText(/الموظف/)).toBeDefined();
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
    fireEvent.change(screen.getByLabelText(/سبب الخصم/), { target: { value: 'Late arrival' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(mocks.createDeduction).toHaveBeenCalledWith({
        employeeId: 1,
        amount: '75',
        payrollMonth: '2026-06',
        reason: 'Late arrival',
      }),
    );
  });

  test('requires a reason and allows it to be edited', async () => {
    mocks.updateDeduction.mockResolvedValue({ ...deduction, reason: 'Policy violation' });
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعديل' }));
    const reason = screen.getByLabelText(/سبب الخصم/);
    expect(reason).toHaveProperty('value', 'Late arrival');
    fireEvent.change(reason, { target: { value: 'Policy violation' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.updateDeduction).toHaveBeenCalledWith(9, {
      amount: '75.00', payrollMonth: '2026-06', reason: 'Policy violation',
    }));
  });

  test('prices a deduction by days from a preset, with no typed amount', async () => {
    mocks.createDeduction.mockResolvedValue(deduction);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة خصم' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });

    // The same day sizes a bonus uses, so a penalty is stated the way an award is.
    expect(screen.getByRole('button', { name: 'يومان' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'يومان' }));
    fireEvent.change(screen.getByLabelText(/شهر الراتب/), { target: { value: '2026-06' } });
    fireEvent.change(screen.getByLabelText(/سبب الخصم/), { target: { value: 'تأخير' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() =>
      expect(mocks.createDeduction).toHaveBeenCalledWith({
        employeeId: 1,
        days: 2,
        payrollMonth: '2026-06',
        reason: 'تأخير',
      }),
    );
  });

  test('clears a typed amount when a day preset is chosen', async () => {
    mocks.createDeduction.mockResolvedValue(deduction);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة خصم' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: 'نصف شهر' }));

    // Both prices filled at once would be ambiguous, so the preset takes the amount's place.
    expect(screen.getByLabelText(/المبلغ/)).toHaveProperty('value', '');
    fireEvent.change(screen.getByLabelText(/شهر الراتب/), { target: { value: '2026-06' } });
    fireEvent.change(screen.getByLabelText(/سبب الخصم/), { target: { value: 'سبب' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(mocks.createDeduction).toHaveBeenCalledWith(expect.objectContaining({ days: 15 })),
    );
  });

  test('clears the day count once an amount is typed', async () => {
    mocks.createDeduction.mockResolvedValue(deduction);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة خصم' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '5 أيام' }));
    expect(screen.getByLabelText(/أو بالأيام/)).toHaveProperty('value', '5');
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '75' } });
    expect(screen.getByLabelText(/أو بالأيام/)).toHaveProperty('value', '');
  });

  test('shows the day count a deduction was priced from', async () => {
    mocks.listDeductions.mockResolvedValue(pageOf([{ ...deduction, days: 5 }]));
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText(/5 أيام/)).toBeDefined();
  });

  test('shows the deductions empty state', async () => {
    mocks.listDeductions.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد خصومات')).toBeDefined();
  });
});

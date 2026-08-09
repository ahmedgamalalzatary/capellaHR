import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listCashierAccounts: vi.fn(),
  promoteCashier: vi.fn(),
  setCashierAccountStatus: vi.fn(),
  resetCashierPassword: vi.fn(),
  listActiveEmployeeOptions: vi.fn(),
}));

vi.mock('../src/features/cashier-accounts/api/cashier-accounts-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCashierAccounts: mocks.listCashierAccounts,
  promoteCashier: mocks.promoteCashier,
  setCashierAccountStatus: mocks.setCashierAccountStatus,
  resetCashierPassword: mocks.resetCashierPassword,
}));

vi.mock('../src/features/cashier-accounts/api/employee-options-api', () => ({
  listActiveEmployeeOptions: mocks.listActiveEmployeeOptions,
}));

import { CashierAccountsView } from '../src/features/cashier-accounts/components/cashier-accounts-view';

const activeAccount = {
  id: 1,
  username: 'cashier1',
  role: 'cashier' as const,
  employeeId: 7,
  branchId: 3,
  active: true,
};

const disabledAccount = {
  ...activeAccount,
  id: 2,
  username: 'cashier2',
  employeeId: 9,
  active: false,
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CashierAccountsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listCashierAccounts.mockResolvedValue(pageOf([activeAccount, disabledAccount]));
  mocks.listActiveEmployeeOptions.mockResolvedValue(
    pageOf([{ id: 7, fullName: 'أحمد جمال' }, { id: 9, fullName: 'سارة محمد' }]),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CashierAccountsView', () => {
  test('announces account loading', () => {
    mocks.listCashierAccounts.mockReturnValue(new Promise(() => undefined));
    renderView();

    expect(screen.getByRole('status', { name: 'جارٍ تحميل الحسابات…' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'حسابات الكاشير' })).toBeDefined();
  });

  test('lists cashier accounts with resolved employee names and status badges', async () => {
    renderView();
    const row1 = (await screen.findByText('cashier1')).closest('tr')!;
    const row2 = (await screen.findByText('cashier2')).closest('tr')!;
    expect(within(row1).getByText('أحمد جمال')).toBeDefined();
    expect(within(row1).getByText('نشط')).toBeDefined();
    expect(within(row2).getByText('سارة محمد')).toBeDefined();
    expect(within(row2).getByText('معطل')).toBeDefined();
  });

  test('shows an Arabic empty state when there are no cashier accounts', async () => {
    mocks.listCashierAccounts.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا يوجد حسابات كاشير بعد')).toBeDefined();
  });

  test('surfaces the Arabic error when the list fails to load', async () => {
    mocks.listCashierAccounts.mockRejectedValue(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }),
    );
    renderView();
    expect(await screen.findByText('تعذر تحميل الحسابات')).toBeDefined();
  });

  test('opens the promote form and loads active employees into the select', async () => {
    renderView();
    await screen.findByText('cashier1');
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء حساب كاشير جديد' }));
    const employeeSelect = screen.getByLabelText(/^الموظف/) as HTMLSelectElement;
    await waitFor(() => expect(within(employeeSelect).getByText('أحمد جمال')).toBeDefined());
    const select = (await screen.findByLabelText(/^الموظف/)) as HTMLSelectElement;
    expect(within(select).getByText('أحمد جمال')).toBeDefined();
  });

  test('promotes an employee to a cashier account and closes the form on success', async () => {
    mocks.promoteCashier.mockResolvedValue({ ...activeAccount, id: 3 });
    renderView();
    await screen.findByText('cashier1');
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء حساب كاشير جديد' }));
    const employeeSelect = screen.getByLabelText(/^الموظف/) as HTMLSelectElement;
    await waitFor(() => expect(within(employeeSelect).getByText('أحمد جمال')).toBeDefined());

    fireEvent.change(screen.getByLabelText(/^الموظف/), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText(/^اسم المستخدم/), { target: { value: 'newcashier' } });
    fireEvent.change(screen.getByLabelText(/^كلمة المرور/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء الحساب' }));

    await waitFor(() => expect(mocks.promoteCashier).toHaveBeenCalledTimes(1));
    expect(mocks.promoteCashier.mock.calls[0]?.[0]).toEqual({
      employeeId: 7,
      username: 'newcashier',
      password: 'secret123',
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'إنشاء الحساب' })).toBeNull(),
    );
  });

  test('shows the Arabic validation message for an empty username', async () => {
    renderView();
    await screen.findByText('cashier1');
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء حساب كاشير جديد' }));
    const employeeSelect = screen.getByLabelText(/^الموظف/) as HTMLSelectElement;
    await waitFor(() => expect(within(employeeSelect).getByText('أحمد جمال')).toBeDefined());
    fireEvent.change(screen.getByLabelText(/^الموظف/), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء الحساب' }));
    expect(await screen.findByText('اسم المستخدم مطلوب')).toBeDefined();
    expect(mocks.promoteCashier).not.toHaveBeenCalled();
  });

  test('surfaces a server error when promotion fails', async () => {
    mocks.promoteCashier.mockRejectedValue(
      new ApiError(409, { code: 'USERNAME_TAKEN', message: 'اسم المستخدم مستخدم بالفعل' }),
    );
    renderView();
    await screen.findByText('cashier1');
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء حساب كاشير جديد' }));
    const employeeSelect = screen.getByLabelText(/^الموظف/) as HTMLSelectElement;
    await waitFor(() => expect(within(employeeSelect).getByText('أحمد جمال')).toBeDefined());
    fireEvent.change(screen.getByLabelText(/^الموظف/), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText(/^اسم المستخدم/), { target: { value: 'newcashier' } });
    fireEvent.change(screen.getByLabelText(/^كلمة المرور/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء الحساب' }));
    expect(await screen.findByText('اسم المستخدم مستخدم بالفعل')).toBeDefined();
  });

  test('disables an active account only after confirmation', async () => {
    mocks.setCashierAccountStatus.mockResolvedValue({ ...activeAccount, active: false });
    renderView();
    const row = (await screen.findByText('cashier1')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعطيل' }));
    expect(mocks.setCashierAccountStatus).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'تعطيل حساب الكاشير' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد التعطيل' }));
    await waitFor(() => expect(mocks.setCashierAccountStatus).toHaveBeenCalledTimes(1));
    expect(mocks.setCashierAccountStatus.mock.calls[0]).toEqual([1, false]);
  });

  test('locks the account-disable dialog while the request is pending', async () => {
    mocks.setCashierAccountStatus.mockReturnValue(new Promise(() => undefined));
    renderView();
    const row = (await screen.findByText('cashier1')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعطيل' }));
    const dialog = screen.getByRole('dialog', { name: 'تعطيل حساب الكاشير' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد التعطيل' }));

    await waitFor(() => expect(mocks.setCashierAccountStatus).toHaveBeenCalledTimes(1));
    expect((within(dialog).getByRole('button', { name: 'تأكيد التعطيل' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'إلغاء' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('re-enables a disabled account without confirmation', async () => {
    mocks.setCashierAccountStatus.mockResolvedValue({ ...disabledAccount, active: true });
    renderView();
    const row = (await screen.findByText('cashier2')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تفعيل' }));
    await waitFor(() => expect(mocks.setCashierAccountStatus).toHaveBeenCalledTimes(1));
    expect(mocks.setCashierAccountStatus.mock.calls[0]).toEqual([2, true]);
  });

  test('resets a cashier password through the dialog', async () => {
    mocks.resetCashierPassword.mockResolvedValue(activeAccount);
    renderView();
    const row = (await screen.findByText('cashier1')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'إعادة تعيين كلمة المرور' }));
    fireEvent.change(await screen.findByLabelText(/^كلمة المرور الجديدة/), {
      target: { value: 'anotherSecret1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.resetCashierPassword).toHaveBeenCalledTimes(1));
    expect(mocks.resetCashierPassword.mock.calls[0]).toEqual([1, 'anotherSecret1']);
  });

  test('paginates with the next button', async () => {
    mocks.listCashierAccounts.mockResolvedValue(pageOf([activeAccount], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('cashier1');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listCashierAccounts.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
    });
  });
});

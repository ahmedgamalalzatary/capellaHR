import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listCashierAccounts: vi.fn(),
  upsertBranchCashier: vi.fn(),
  setCashierAccountStatus: vi.fn(),
  deleteCashierAccount: vi.fn(),
  listActiveEmployeeOptions: vi.fn(),
  listBranchCashierRoster: vi.fn(),
  replaceBranchCashierRoster: vi.fn(),
  listCashierSessionBranches: vi.fn(),
}));

vi.mock('../src/features/cashier-accounts/api/cashier-accounts-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCashierAccounts: mocks.listCashierAccounts,
  upsertBranchCashier: mocks.upsertBranchCashier,
  setCashierAccountStatus: mocks.setCashierAccountStatus,
  deleteCashierAccount: mocks.deleteCashierAccount,
}));

vi.mock('../src/features/cashier-accounts/api/employee-options-api', () => ({
  listActiveEmployeeOptions: mocks.listActiveEmployeeOptions,
}));

vi.mock('../src/features/cashier-accounts/api/branch-roster-api', () => ({
  listBranchCashierRoster: mocks.listBranchCashierRoster,
  replaceBranchCashierRoster: mocks.replaceBranchCashierRoster,
}));

vi.mock('../src/features/cashier-sessions', () => ({
  listCashierSessionBranches: mocks.listCashierSessionBranches,
}));

import { CashierAccountsView } from '../src/features/cashier-accounts/components/cashier-accounts-view';

const activeAccount = {
  id: 1,
  username: 'nasr',
  role: 'cashier' as const,
  branchId: 3,
  branchName: 'فرع مدينة نصر',
  active: true,
};

const disabledAccount = {
  ...activeAccount,
  id: 2,
  username: 'maadi',
  branchName: 'فرع المعادي',
  active: false,
};

const branches = [
  { id: 3, name: 'فرع مدينة نصر' },
  { id: 4, name: 'فرع المعادي' },
];

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
  mocks.upsertBranchCashier.mockResolvedValue(activeAccount);
  mocks.listCashierSessionBranches.mockResolvedValue(pageOf(branches));
  mocks.listActiveEmployeeOptions.mockResolvedValue(
    pageOf([{ id: 7, fullName: 'أحمد جمال' }, { id: 9, fullName: 'سارة محمد' }]),
  );
  mocks.listBranchCashierRoster.mockResolvedValue([
    { id: 7, employeeCode: 1007, fullName: 'أحمد جمال' },
  ]);
  mocks.replaceBranchCashierRoster.mockResolvedValue([
    { id: 7, employeeCode: 1007, fullName: 'أحمد جمال' },
  ]);
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
    expect(screen.getByRole('heading', { level: 1, name: 'حسابات كاشير الفروع' })).toBeDefined();
  });

  test('lists branch logins with their branch names and status badges', async () => {
    renderView();
    const row1 = (await screen.findByText('nasr')).closest('tr')!;
    const row2 = (await screen.findByText('maadi')).closest('tr')!;
    expect(within(row1).getByText('فرع مدينة نصر')).toBeDefined();
    expect(within(row1).getByText('نشط')).toBeDefined();
    expect(within(row2).getByText('فرع المعادي')).toBeDefined();
    expect(within(row2).getByText('معطل')).toBeDefined();
  });

  test('shows an Arabic empty state when no branch logins exist', async () => {
    mocks.listCashierAccounts.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد حسابات فروع بعد')).toBeDefined();
  });

  test('surfaces the Arabic error when the list fails to load', async () => {
    mocks.listCashierAccounts.mockRejectedValue(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }),
    );
    renderView();
    expect(await screen.findByText('تعذر تحميل الحسابات')).toBeDefined();
  });

  test('saves the credentials of the selected branch login', async () => {
    renderView();
    const branchSelect = (await screen.findByLabelText('فرع بيانات الدخول')) as HTMLSelectElement;
    await waitFor(() => expect(within(branchSelect).getByText('فرع مدينة نصر')).toBeDefined());

    fireEvent.change(branchSelect, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^اسم المستخدم/), { target: { value: 'Nasr' } });
    fireEvent.change(screen.getByLabelText(/^كلمة المرور/, { selector: 'input:not([aria-label])' }), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ بيانات الدخول' }));

    await waitFor(() => expect(mocks.upsertBranchCashier).toHaveBeenCalledTimes(1));
    expect(mocks.upsertBranchCashier.mock.calls[0]?.[0]).toEqual({
      branchId: 3,
      username: 'nasr',
      password: 'secret123',
    });
  });

  test('shows the Arabic validation message when the branch is missing', async () => {
    renderView();
    await screen.findByText('nasr');
    fireEvent.change(screen.getByLabelText(/^اسم المستخدم/), { target: { value: 'nasr' } });
    fireEvent.change(screen.getByLabelText(/^كلمة المرور/, { selector: 'input:not([aria-label])' }), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ بيانات الدخول' }));

    expect(await screen.findByText('يجب اختيار الفرع')).toBeDefined();
    expect(mocks.upsertBranchCashier).not.toHaveBeenCalled();
  });

  test('surfaces a server error when saving credentials fails', async () => {
    mocks.upsertBranchCashier.mockRejectedValue(
      new ApiError(409, { code: 'USERNAME_TAKEN', message: 'اسم المستخدم مستخدم بالفعل' }),
    );
    renderView();
    const branchSelect = (await screen.findByLabelText('فرع بيانات الدخول')) as HTMLSelectElement;
    await waitFor(() => expect(within(branchSelect).getByText('فرع مدينة نصر')).toBeDefined());

    fireEvent.change(branchSelect, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^اسم المستخدم/), { target: { value: 'nasr' } });
    fireEvent.change(screen.getByLabelText(/^كلمة المرور/, { selector: 'input:not([aria-label])' }), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ بيانات الدخول' }));

    expect(await screen.findByText('اسم المستخدم مستخدم بالفعل')).toBeDefined();
  });

  test('preserves server field errors that do not include the branch', async () => {
    mocks.upsertBranchCashier.mockRejectedValue(new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'invalid credentials',
      fieldErrors: { username: ['username rejected by server'] },
    }));
    renderView();
    const branchSelect = document.querySelector<HTMLSelectElement>('#branch-login-branch')!;
    await waitFor(() => expect(branchSelect.options.length).toBeGreaterThan(1));
    fireEvent.change(branchSelect, { target: { value: '3' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('#branch-login-username')!, {
      target: { value: 'nasr' },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>('#branch-login-password')!, {
      target: { value: 'secret123' },
    });
    const card = branchSelect.closest<HTMLElement>('.rounded-card')!;
    fireEvent.click(within(card).getByRole('button'));

    expect(await screen.findByText('username rejected by server')).toBeDefined();
    expect(screen.queryByText('invalid credentials')).toBeNull();
  });

  test('disables an active branch login only after confirmation', async () => {
    mocks.setCashierAccountStatus.mockResolvedValue({ ...activeAccount, active: false });
    renderView();
    const row = (await screen.findByText('nasr')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعطيل' }));
    expect(mocks.setCashierAccountStatus).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'تعطيل حساب الكاشير' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد التعطيل' }));
    await waitFor(() => expect(mocks.setCashierAccountStatus).toHaveBeenCalledTimes(1));
    expect(mocks.setCashierAccountStatus.mock.calls[0]).toEqual([1, false]);
  });

  test('re-enables a disabled branch login without confirmation', async () => {
    mocks.setCashierAccountStatus.mockResolvedValue({ ...disabledAccount, active: true });
    renderView();
    const row = (await screen.findByText('maadi')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تفعيل' }));
    await waitFor(() => expect(mocks.setCashierAccountStatus).toHaveBeenCalledTimes(1));
    expect(mocks.setCashierAccountStatus.mock.calls[0]).toEqual([2, true]);
  });

  test('edits the username and password of a branch login through the dialog', async () => {
    renderView();
    const row = (await screen.findByText('nasr')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'تعديل بيانات الدخول' }));

    const dialog = await screen.findByRole('dialog', { name: /تعديل بيانات دخول nasr/ });
    const username = within(dialog).getByLabelText(/^اسم المستخدم/) as HTMLInputElement;
    const password = within(dialog).getByLabelText(/^كلمة المرور/) as HTMLInputElement;
    // The current name is offered for editing; the password is never known here.
    expect(username.value).toBe('nasr');
    expect(password.value).toBe('');

    fireEvent.change(username, { target: { value: 'Nasr.New' } });
    fireEvent.change(password, { target: { value: 'secret123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(mocks.upsertBranchCashier).toHaveBeenCalledTimes(1));
    expect(mocks.upsertBranchCashier.mock.calls[0]?.[0]).toEqual({
      branchId: 3,
      username: 'nasr.new',
      password: 'secret123',
    });
  });

  test('keeps the credentials dialog open and shows why the edit failed', async () => {
    mocks.upsertBranchCashier.mockRejectedValue(
      new ApiError(409, { code: 'USERNAME_TAKEN', message: 'اسم المستخدم مستخدم بالفعل' }),
    );
    renderView();
    const row = (await screen.findByText('nasr')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعديل بيانات الدخول' }));

    const dialog = await screen.findByRole('dialog', { name: /تعديل بيانات دخول nasr/ });
    fireEvent.change(within(dialog).getByLabelText(/^كلمة المرور/), {
      target: { value: 'secret123' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));

    expect(await screen.findByText('اسم المستخدم مستخدم بالفعل')).toBeDefined();
    expect(screen.getByRole('dialog', { name: /تعديل بيانات دخول nasr/ })).toBeDefined();
  });

  test('deletes a branch login only after confirmation and refreshes the list', async () => {
    mocks.deleteCashierAccount.mockResolvedValue({ ...activeAccount, active: false });
    renderView();
    const row = (await screen.findByText('nasr')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    expect(mocks.deleteCashierAccount).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'حذف حساب الكاشير' });
    // The admin is told the sales history survives before they confirm.
    expect(dialog.textContent).toContain('الفواتير');
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد الحذف' }));

    await waitFor(() => expect(mocks.deleteCashierAccount).toHaveBeenCalledTimes(1));
    expect(mocks.deleteCashierAccount.mock.calls[0]).toEqual([1]);
    await waitFor(() => expect(mocks.listCashierAccounts.mock.calls.length).toBeGreaterThan(1));
  });

  test('keeps the delete dialog open and shows why the deletion failed', async () => {
    mocks.deleteCashierAccount.mockRejectedValue(
      new ApiError(404, { code: 'ACCOUNT_NOT_FOUND', message: 'حساب الكاشير غير موجود' }),
    );
    renderView();
    const row = (await screen.findByText('nasr')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));

    expect(await screen.findByText('حساب الكاشير غير موجود')).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'حذف حساب الكاشير' })).toBeDefined();
  });

  test('loads the branch roster and saves the edited members', async () => {
    renderView();
    await screen.findByText('nasr');
    const rosterBranch = (await screen.findByLabelText('فرع الوردية')) as HTMLSelectElement;
    await waitFor(() => expect(within(rosterBranch).getByText('فرع مدينة نصر')).toBeDefined());

    fireEvent.change(rosterBranch, { target: { value: '3' } });
    const ahmed = await screen.findByLabelText('أحمد جمال') as HTMLInputElement;
    const sara = await screen.findByLabelText('سارة محمد') as HTMLInputElement;
    expect(ahmed.checked).toBe(true);
    expect(sara.checked).toBe(false);

    fireEvent.click(sara);
    fireEvent.click(screen.getByRole('button', { name: 'حفظ وردية الفرع' }));

    await waitFor(() => expect(mocks.replaceBranchCashierRoster).toHaveBeenCalledTimes(1));
    expect(mocks.replaceBranchCashierRoster.mock.calls[0]).toEqual([3, [7, 9]]);
  });

  test('excludes roster members hidden from the active employee list when saving', async () => {
    mocks.listBranchCashierRoster.mockResolvedValue([
      { id: 99, employeeCode: 1099, fullName: 'inactive employee' },
    ]);
    renderView();
    const rosterBranch = document.querySelector<HTMLSelectElement>('#roster-branch')!;
    await waitFor(() => expect(rosterBranch.options.length).toBeGreaterThan(1));
    fireEvent.change(rosterBranch, { target: { value: '3' } });
    const card = rosterBranch.closest<HTMLElement>('.rounded-card')!;
    await waitFor(() => expect(card.querySelectorAll('input[type="checkbox"]')).toHaveLength(2));
    fireEvent.click(within(card).getByRole('button'));

    await waitFor(() => expect(mocks.replaceBranchCashierRoster).toHaveBeenCalledWith(3, []));
  });

  test('re-seeds an identical roster when switching branches', async () => {
    renderView();
    const rosterBranch = document.querySelector<HTMLSelectElement>('#roster-branch')!;
    await waitFor(() => expect(rosterBranch.options.length).toBeGreaterThan(1));
    fireEvent.change(rosterBranch, { target: { value: '3' } });
    const card = rosterBranch.closest<HTMLElement>('.rounded-card')!;
    await waitFor(() => {
      const first = card.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(first.checked).toBe(true);
    });
    fireEvent.click(card.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(card.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);

    fireEvent.change(rosterBranch, { target: { value: '4' } });

    await waitFor(() => {
      const first = card.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(first.checked).toBe(true);
    });
  });

  test('shows branch-loading failures with recovery actions on both admin forms', async () => {
    mocks.listCashierSessionBranches.mockRejectedValue(new ApiError(500, {
      code: 'UNEXPECTED_ERROR',
      message: 'branches unavailable',
    }));
    renderView();

    expect(await screen.findAllByText('branches unavailable')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'إعادة المحاولة' })).toHaveLength(2);
  });

  test('shows employee-loading failures and blocks roster saving', async () => {
    mocks.listActiveEmployeeOptions.mockRejectedValue(new ApiError(500, {
      code: 'UNEXPECTED_ERROR',
      message: 'employee options unavailable',
    }));
    renderView();
    const rosterBranch = document.querySelector<HTMLSelectElement>('#roster-branch')!;
    await waitFor(() => expect(rosterBranch.options.length).toBeGreaterThan(1));

    fireEvent.change(rosterBranch, { target: { value: '3' } });

    expect(await screen.findByText('employee options unavailable')).toBeDefined();
    const rosterCard = rosterBranch.closest<HTMLElement>('.rounded-card')!;
    expect(within(rosterCard).getAllByRole('button').find((button) => button.hasAttribute('disabled')))
      .toBeDefined();
  });

  test('steps back a page when the last account on it is deleted', async () => {
    mocks.listCashierAccounts.mockResolvedValue(pageOf([activeAccount], { total: 21, totalPages: 2 }));
    mocks.deleteCashierAccount.mockResolvedValue({ ...activeAccount, active: false });
    renderView();
    await screen.findByText('nasr');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      expect(mocks.listCashierAccounts.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 });
    });

    const row = (await screen.findByText('nasr')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));

    await waitFor(() => expect(mocks.deleteCashierAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(mocks.listCashierAccounts.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1 });
    });
  });

  test('paginates with the next button', async () => {
    mocks.listCashierAccounts.mockResolvedValue(pageOf([activeAccount], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('nasr');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listCashierAccounts.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
    });
  });
});

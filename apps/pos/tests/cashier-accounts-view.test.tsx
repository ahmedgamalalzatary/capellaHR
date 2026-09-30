import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listCashierAccounts: vi.fn(), saveCashierAccount: vi.fn(),
  setCashierAccountStatus: vi.fn(), deleteCashierAccount: vi.fn(),
  listActiveEmployeeOptions: vi.fn(), listBranchCashierRoster: vi.fn(), listCashierSessionBranches: vi.fn(),
}));
vi.mock('../src/features/cashier-accounts/api/cashier-accounts-api', async (original) => ({ ...(await original<object>()), ...mocks }));
vi.mock('../src/features/cashier-accounts/api/employee-options-api', () => ({ listActiveEmployeeOptions: mocks.listActiveEmployeeOptions }));
vi.mock('../src/features/cashier-accounts/api/branch-roster-api', () => ({ listBranchCashierRoster: mocks.listBranchCashierRoster }));
vi.mock('../src/features/cashier-sessions', () => ({ listCashierSessionBranches: mocks.listCashierSessionBranches }));
import { CashierAccountsView } from '../src/features/cashier-accounts/components/cashier-accounts-view';

const account = {
  id: 1, username: 'nasr', role: 'cashier' as const, branchId: 3, branchName: 'فرع مدينة نصر', active: true,
  employees: [{ id: 7, fullName: 'أحمد جمال' }],
};
const disabled = { ...account, id: 2, username: 'maadi', branchId: 4, branchName: 'فرع المعادي', active: false, employees: [] };
const members = [{ id: 7, employeeCode: 1007, fullName: 'أحمد جمال' }];
const pageOf = (items: unknown[], meta: Record<string, number> = {}) => ({ items, meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta } });
function renderView() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CashierAccountsView /></QueryClientProvider>);
}
async function edit() {
  const row = (await screen.findByText('nasr')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'تعديل' }));
  const dialog = screen.getByRole('dialog', { name: 'تعديل حساب الكاشير' });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }).hasAttribute('disabled')).toBe(false));
  return dialog;
}
async function create() {
  fireEvent.click(screen.getByRole('button', { name: 'إضافة حساب كاشير' }));
  const dialog = screen.getByRole('dialog', { name: 'إضافة حساب كاشير' });
  const branch = within(dialog).getByLabelText(/^الفرع/) as HTMLSelectElement;
  await waitFor(() => expect(branch.options.length).toBeGreaterThan(1));
  fireEvent.change(branch, { target: { value: '5' } });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'حفظ الحساب' }).hasAttribute('disabled')).toBe(false));
  fireEvent.change(within(dialog).getByLabelText(/^اسم المستخدم/), { target: { value: ' New.Cashier ' } });
  return dialog;
}
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.resetAllMocks();
  mocks.listCashierAccounts.mockResolvedValue(pageOf([account, disabled]));
  mocks.saveCashierAccount.mockResolvedValue(account);
  mocks.listCashierSessionBranches.mockResolvedValue(pageOf([{ id: 3, name: account.branchName }, { id: 4, name: disabled.branchName }, { id: 5, name: 'فرع جديد' }, { id: 6, name: 'فرع آخر' }]));
  mocks.listActiveEmployeeOptions.mockResolvedValue(pageOf([{ id: 7, fullName: 'أحمد جمال' }, { id: 9, fullName: 'سارة محمد' }]));
  mocks.listBranchCashierRoster.mockResolvedValue(members);
});
afterEach(cleanup);

describe('unified cashier account management', () => {
  test('edits credentials without an employee picker or roster dependency', async () => {
    mocks.listBranchCashierRoster.mockRejectedValue(new Error('obsolete roster'));
    mocks.listActiveEmployeeOptions.mockRejectedValue(new Error('obsolete employee options'));
    renderView();
    const dialog = await edit();
    expect(within(dialog).queryByRole('button', { name: /الموظفون المسموح لهم بالبيع/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));
    await waitFor(() => expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual({
      mode: 'edit', accountId: 1, branchId: 3, username: 'nasr',
    }));
  });
  test('shows account loading, list failures and an empty-state creation action', async () => {
    mocks.listCashierAccounts.mockRejectedValue(new ApiError(500, { code: 'ERROR', message: 'تعذر الاتصال' }));
    renderView();
    expect(screen.getByRole('status', { name: 'جارٍ تحميل الحسابات…' })).toBeDefined();
    expect(await screen.findByText('تعذر تحميل الحسابات')).toBeDefined();
    mocks.listCashierAccounts.mockResolvedValue(pageOf([]));
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('لا توجد حسابات فروع بعد')).toBeDefined();
    expect(screen.getByRole('button', { name: 'إضافة حساب كاشير' })).toBeDefined();
  });
  test('edits username without employee selection while keeping a blank password', async () => {
    renderView();
    const dialog = await edit();
    expect((within(dialog).getByLabelText(/^اسم المستخدم/) as HTMLInputElement).value).toBe('nasr');
    expect((within(dialog).getByLabelText(/^الفرع/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/^اسم المستخدم/), { target: { value: ' New.Name ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));
    await waitFor(() => expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual({ mode: 'edit', accountId: 1, branchId: 3, username: 'new.name' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  test('creates credentials without employee selection', async () => {
    renderView();
    const dialog = await create();
    const branch = within(dialog).getByLabelText(/^الفرع/);
    expect(within(branch).queryByRole('option', { name: account.branchName })).toBeNull();
    expect(within(branch).queryByRole('option', { name: disabled.branchName })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^كلمة المرور/), { target: { value: 'secret' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ الحساب' }));
    await waitFor(() => expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual({ mode: 'create', branchId: 5, username: 'new.cashier', password: 'secret' }));
  });
  test('requires a password on creation', async () => {
    renderView();
    const dialog = await create();
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ الحساب' }));
    expect(await within(dialog).findByText('كلمة المرور مطلوبة')).toBeDefined();
    expect(mocks.saveCashierAccount).not.toHaveBeenCalled();
  });
  test('shows branch load errors with retry before allowing creation', async () => {
    mocks.listCashierSessionBranches.mockRejectedValue(new ApiError(500, { code: 'ERROR', message: 'تعذر تحميل الفروع' }));
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'إضافة حساب كاشير' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('تعذر تحميل الفروع')).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'حفظ الحساب' }).hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'إعادة المحاولة' })).toBeDefined();
  });
  test('accepts a replacement password on edit and retains values after a save failure', async () => {
    mocks.saveCashierAccount.mockRejectedValue(new ApiError(409, { code: 'USERNAME_TAKEN', message: 'اسم المستخدم مستخدم بالفعل' }));
    renderView();
    const dialog = await edit();
    fireEvent.change(within(dialog).getByLabelText(/^كلمة المرور/), { target: { value: 'replacement' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));
    expect(await within(dialog).findByText('اسم المستخدم مستخدم بالفعل')).toBeDefined();
    expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual({ mode: 'edit', accountId: 1, branchId: 3, username: 'nasr', password: 'replacement' });
    expect((within(dialog).getByLabelText(/^كلمة المرور/) as HTMLInputElement).value).toBe('replacement');
  });
  test('shows server field errors in the form', async () => {
    mocks.saveCashierAccount.mockRejectedValue(new ApiError(400, { code: 'VALIDATION_ERROR', message: 'invalid', fieldErrors: { username: ['اسم غير مقبول'] } }));
    renderView();
    const dialog = await edit();
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));
    expect(await within(dialog).findByText('اسم غير مقبول')).toBeDefined();
  });
  test('disables and deletes only after confirmation and enables directly', async () => {
    mocks.setCashierAccountStatus.mockResolvedValue(account);
    mocks.deleteCashierAccount.mockResolvedValue(disabled);
    renderView();
    const row = (await screen.findByText('nasr')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعطيل' }));
    expect(mocks.setCashierAccountStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد التعطيل' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.setCashierAccountStatus).toHaveBeenCalledWith(1, false);
    fireEvent.click(within(screen.getByText('maadi').closest('tr')!).getByRole('button', { name: 'تفعيل' }));
    await waitFor(() => expect(mocks.setCashierAccountStatus).toHaveBeenCalledWith(2, true));
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    expect(mocks.deleteCashierAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('الفواتير');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(mocks.deleteCashierAccount).toHaveBeenCalledWith(1));
  });
  test('steps back when deleting the last account on a later page', async () => {
    mocks.listCashierAccounts.mockResolvedValue(pageOf([account], { total: 21, totalPages: 2 }));
    mocks.deleteCashierAccount.mockResolvedValue(account);
    renderView();
    await screen.findByText('nasr');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => expect(mocks.listCashierAccounts.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 }));
    fireEvent.click(within((await screen.findByText('nasr')).closest('tr')!).getByRole('button', { name: 'حذف' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(mocks.listCashierAccounts.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1 }));
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const account = { id: 1, username: 'nasr', role: 'cashier' as const, branchId: 3, branchName: 'فرع مدينة نصر', active: true };
const disabled = { ...account, id: 2, username: 'maadi', branchId: 4, branchName: 'فرع المعادي', active: false };
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
  vi.resetAllMocks();
  mocks.listCashierAccounts.mockResolvedValue(pageOf([account, disabled]));
  mocks.saveCashierAccount.mockResolvedValue(account);
  mocks.listCashierSessionBranches.mockResolvedValue(pageOf([{ id: 3, name: account.branchName }, { id: 4, name: disabled.branchName }, { id: 5, name: 'فرع جديد' }, { id: 6, name: 'فرع آخر' }]));
  mocks.listActiveEmployeeOptions.mockResolvedValue(pageOf([{ id: 7, fullName: 'أحمد جمال' }, { id: 9, fullName: 'سارة محمد' }]));
  mocks.listBranchCashierRoster.mockResolvedValue(members);
});
afterEach(cleanup);

describe('unified cashier account management', () => {
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
  test('shows assigned employees beside the account and its status', async () => {
    renderView();
    const row = (await screen.findByText('nasr')).closest('tr')!;
    expect(await within(row).findByText('أحمد جمال')).toBeDefined();
    expect(within(row).getByText('نشط')).toBeDefined();
  });
  test('edits username and employees together while keeping a blank password', async () => {
    renderView();
    const dialog = await edit();
    expect((within(dialog).getByLabelText(/^اسم المستخدم/) as HTMLInputElement).value).toBe('nasr');
    expect((within(dialog).getByLabelText(/^الفرع/) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /الموظفون المسموح لهم بالبيع/ }));
    expect((within(dialog).getByRole('checkbox', { name: 'أحمد جمال' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'سارة' } });
    expect(within(dialog).queryByRole('checkbox', { name: 'أحمد جمال' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'سارة محمد' }));
    fireEvent.change(within(dialog).getByLabelText(/^اسم المستخدم/), { target: { value: ' New.Name ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));
    await waitFor(() => expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual({ mode: 'edit', accountId: 1, branchId: 3, username: 'new.name', employeeIds: [7, 9] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  test('creates credentials and selected employees in a single save', async () => {
    renderView();
    const dialog = await create();
    const branch = within(dialog).getByLabelText(/^الفرع/);
    expect(within(branch).queryByRole('option', { name: account.branchName })).toBeNull();
    expect(within(branch).queryByRole('option', { name: disabled.branchName })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^كلمة المرور/), { target: { value: 'secret' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /الموظفون المسموح لهم بالبيع/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'سارة محمد' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ الحساب' }));
    await waitFor(() => expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual({ mode: 'create', branchId: 5, username: 'new.cashier', password: 'secret', employeeIds: [7, 9] }));
  });
  test('requires a password on creation', async () => {
    renderView();
    const dialog = await create();
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ الحساب' }));
    expect(await within(dialog).findByText('كلمة المرور مطلوبة')).toBeDefined();
    expect(mocks.saveCashierAccount).not.toHaveBeenCalled();
  });
  test('resets employee selection when switching branches without leaking the previous draft', async () => {
    renderView();
    const dialog = await create();
    fireEvent.click(within(dialog).getByRole('button', { name: /الموظفون المسموح لهم بالبيع/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'أحمد جمال' }));
    fireEvent.change(within(dialog).getByLabelText(/^الفرع/), { target: { value: '6' } });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'حفظ الحساب' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(within(dialog).getByRole('button', { name: /الموظفون المسموح لهم بالبيع/ }));
    expect((within(dialog).getByRole('checkbox', { name: 'أحمد جمال' }) as HTMLInputElement).checked).toBe(true);
  });
  test('does not silently save an empty roster after its read fails', async () => {
    mocks.listBranchCashierRoster.mockRejectedValue(new ApiError(500, { code: 'ERROR', message: 'تعذر تحميل الاختيارات' }));
    renderView();
    fireEvent.click(within((await screen.findByText('nasr')).closest('tr')!).getByRole('button', { name: 'تعديل' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('تعذر تحميل الاختيارات')).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }).hasAttribute('disabled')).toBe(true);
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
    expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual({ mode: 'edit', accountId: 1, branchId: 3, username: 'nasr', password: 'replacement', employeeIds: [7] });
    expect((within(dialog).getByLabelText(/^كلمة المرور/) as HTMLInputElement).value).toBe('replacement');
  });
  test('shows server field errors in the form', async () => {
    mocks.saveCashierAccount.mockRejectedValue(new ApiError(400, { code: 'VALIDATION_ERROR', message: 'invalid', fieldErrors: { username: ['اسم غير مقبول'] } }));
    renderView();
    const dialog = await edit();
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));
    expect(await within(dialog).findByText('اسم غير مقبول')).toBeDefined();
  });
  test('blocks saving when employee loading fails and allows retry', async () => {
    mocks.listActiveEmployeeOptions.mockRejectedValue(new ApiError(500, { code: 'ERROR', message: 'تعذر تحميل الموظفين' }));
    renderView();
    fireEvent.click(within((await screen.findByText('nasr')).closest('tr')!).getByRole('button', { name: 'تعديل' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('تعذر تحميل الموظفين')).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }).hasAttribute('disabled')).toBe(true);
    mocks.listActiveEmployeeOptions.mockResolvedValue(pageOf([{ id: 7, fullName: 'أحمد جمال' }]));
    fireEvent.click(within(dialog).getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }).hasAttribute('disabled')).toBe(false));
  });
  test('clears every employee and closes the dropdown with Escape without closing the form', async () => {
    renderView();
    const dialog = await edit();
    const trigger = within(dialog).getByRole('button', { name: /الموظفون المسموح لهم بالبيع/ });
    fireEvent.click(trigger);
    const checkbox = within(dialog).getByRole('checkbox', { name: 'أحمد جمال' });
    fireEvent.click(checkbox);
    fireEvent.keyDown(checkbox, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));
    await waitFor(() => expect(mocks.saveCashierAccount.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ employeeIds: [] })));
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

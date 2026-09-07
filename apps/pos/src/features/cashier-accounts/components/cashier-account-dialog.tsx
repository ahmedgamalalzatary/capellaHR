'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Field, Input, Modal } from '@capella/ui';
import type { SaveCashierAccountInput } from '@capella/contracts';
import { Select } from '@/components/form/select';
import { FieldError } from '@/components/feedback/notice';
import { LoadingState } from '@/components/feedback/loading-state';
import { listCashierSessionBranches } from '@/features/cashier-sessions';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { listActiveEmployeeOptions } from '../api/employee-options-api';
import { listBranchCashierRoster } from '../api/branch-roster-api';
import { listCashierAccounts, saveCashierAccount, type CashierAccount } from '../api/cashier-accounts-api';
import { cashierAccountQueryKeys } from '../query-keys';
import { branchCashierCredentialsFormSchema, editCashierCredentialsFormSchema } from '../schemas/cashier-account-schemas';
import { EmployeeMultiSelect } from './employee-multi-select';

const message = (error: unknown) => error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';

export function CashierAccountDialog({ account, onClose }: { account: CashierAccount | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState(account?.branchId ?? 0);
  const [username, setUsername] = useState(account?.username ?? '');
  const [password, setPassword] = useState('');
  const [selection, setSelection] = useState<number[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const branches = useQuery({
    queryKey: ['cashier-accounts', 'branches'],
    queryFn: () => fetchAllPages((page) => listCashierSessionBranches(page)),
    enabled: !account,
  });
  const accounts = useQuery({
    queryKey: ['cashier-accounts', 'options'],
    queryFn: () => fetchAllPages((page) => listCashierAccounts({ page })),
    enabled: !account,
  });
  const roster = useQuery({
    queryKey: cashierAccountQueryKeys.roster(branchId),
    queryFn: () => listBranchCashierRoster({ branchId }),
    enabled: branchId > 0,
  });
  const employees = useQuery({
    queryKey: ['employees', 'options', 'active', branchId],
    queryFn: () => fetchAllPages((page) => listActiveEmployeeOptions(page, branchId)),
    enabled: branchId > 0,
  });
  const activeIds = new Set((employees.data ?? []).map(({ id }) => id));
  const assigned = account?.employees ?? roster.data?.map(({ id, fullName }) => ({ id, fullName })) ?? [];
  const selected = (selection ?? assigned.map(({ id }) => id)).filter((id) => activeIds.has(id));
  const dropped = assigned.filter(({ id }) => !activeIds.has(id));
  const usedBranches = new Set((accounts.data ?? []).map(({ branchId }) => branchId));
  const availableBranches = (branches.data ?? []).filter(({ id }) => !usedBranches.has(id));
  const ready = branchId > 0 && roster.isSuccess && employees.isSuccess
    && (account !== null || (branches.isSuccess && accounts.isSuccess && !usedBranches.has(branchId)));

  const save = useMutation({
    mutationFn: saveCashierAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.values(error.fieldErrors).some((values) => values?.length)) {
        setErrors(error.fieldErrors);
      } else {
        setErrors({ _: [message(error)] });
      }
    },
  });

  const submit = () => {
    if (!ready || save.isPending) return;
    const parsed = (account ? editCashierCredentialsFormSchema : branchCashierCredentialsFormSchema).safeParse({
      branchId, username, password: account && password === '' ? undefined : password,
    });
    if (!parsed.success) { setErrors(parsed.error.flatten().fieldErrors); return; }
    const values = { branchId, username: parsed.data.username, employeeIds: selected };
    const input: SaveCashierAccountInput = account
      ? { ...values, mode: 'edit', accountId: account.id, ...(password === '' ? {} : { password }) }
      : { ...values, mode: 'create', password };
    setErrors({});
    save.mutate(input);
  };

  const loadError = !account && (branches.isError || accounts.isError)
    ? branches.error ?? accounts.error
    : branchId > 0 && (roster.isError || employees.isError) ? roster.error ?? employees.error : null;
  const retry = () => {
    if (branches.isError) void branches.refetch();
    if (accounts.isError) void accounts.refetch();
    if (roster.isError) void roster.refetch();
    if (employees.isError) void employees.refetch();
  };

  return (
    <Modal title={account ? 'تعديل حساب الكاشير' : 'إضافة حساب كاشير'} onClose={onClose}
      dismissOnBackdrop={!save.isPending} className="max-h-[90dvh] max-w-lg overflow-y-auto">
      <form noValidate className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Field label="الفرع" htmlFor="cashier-branch" required>
          {account ? <Input id="cashier-branch" value={account.branchName} disabled /> : (
            <Select id="cashier-branch" value={branchId || ''}
              disabled={save.isPending || !branches.isSuccess || !accounts.isSuccess}
              onChange={(event) => { setBranchId(Number(event.target.value)); setSelection(null); setErrors({}); }}>
              <option value="">اختر الفرع</option>
              {availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          )}
        </Field>
        {!account && branches.isSuccess && accounts.isSuccess && availableBranches.length === 0
          ? <p className="text-sm text-muted">كل الفروع لديها حساب كاشير. يمكنك تعديل الحساب من الجدول.</p> : null}
        <Field label="اسم المستخدم" htmlFor="cashier-username" required>
          <Input id="cashier-username" autoComplete="off" value={username} disabled={save.isPending}
            aria-invalid={!!errors.username} onChange={(event) => setUsername(event.target.value)} />
          {errors.username ? <FieldError>{errors.username[0]}</FieldError> : null}
        </Field>
        <Field label={account ? 'كلمة المرور الجديدة' : 'كلمة المرور'} htmlFor="cashier-password" required={!account}>
          <Input id="cashier-password" type="password" autoComplete="new-password" value={password} disabled={save.isPending}
            aria-invalid={!!errors.password} onChange={(event) => setPassword(event.target.value)} />
          {account ? <p className="text-xs text-muted">اتركها فارغة للاحتفاظ بكلمة المرور الحالية.</p> : null}
          {errors.password ? <FieldError>{errors.password[0]}</FieldError> : null}
        </Field>
        {loadError ? <div className="space-y-2"><FieldError>{message(loadError)}</FieldError><Button variant="secondary" onClick={retry}>إعادة المحاولة</Button></div>
          : branchId === 0 ? <p className="text-sm text-muted">اختر الفرع لعرض الموظفين المسموح لهم بالبيع.</p>
          : !roster.isSuccess || !employees.isSuccess ? <LoadingState label="جارٍ تحميل الموظفين…" />
          : <EmployeeMultiSelect key={branchId} employees={employees.data} selected={selected} onChange={setSelection} disabled={save.isPending} />}
        {roster.isSuccess && employees.isSuccess && dropped.length > 0
          ? <p className="text-xs text-muted">{dropped.map(({ fullName }) => fullName).join('، ')} لم تعد ضمن الموظفين النشطين لهذا الفرع، ولن تُحفظ في التعيين.</p> : null}
        {roster.isSuccess && employees.isSuccess && selected.length === 0 && branchId > 0
          ? <p className="text-xs text-muted">لن يتمكن أي موظف من البيع بهذا الحساب حتى تختار موظفًا.</p> : null}
        {Object.entries(errors).filter(([key]) => key !== 'username' && key !== 'password').map(([key, values]) => values?.[0] ? <FieldError key={key}>{values[0]}</FieldError> : null)}
        {account && (password !== '' || username.trim().toLowerCase() !== account.username)
          ? <p className="text-xs text-muted">تغيير بيانات الدخول يسجل خروج الجلسات المفتوحة بهذا الحساب.</p> : null}
        <div className="flex gap-2 border-t border-line pt-4">
          <Button type="submit" disabled={!ready || save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : account ? 'حفظ التغييرات' : 'حفظ الحساب'}</Button>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>إلغاء</Button>
        </div>
      </form>
    </Modal>
  );
}

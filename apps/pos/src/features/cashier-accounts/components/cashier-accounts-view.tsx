'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { PageHeader } from '@/components/layout/page-header';
import { Select } from '@/components/form/select';
import { listCashierSessionBranches } from '@/features/cashier-sessions';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { listActiveEmployeeOptions } from '../api/employee-options-api';
import {
  listCashierAccounts,
  resetCashierPassword,
  setCashierAccountStatus,
  upsertBranchCashier,
  type CashierAccount,
} from '../api/cashier-accounts-api';
import {
  listBranchCashierRoster,
  replaceBranchCashierRoster,
} from '../api/branch-roster-api';
import { cashierAccountQueryKeys } from '../query-keys';
import { branchCashierCredentialsFormSchema } from '../schemas/cashier-account-schemas';
import { ResetPasswordDialog } from './reset-password-dialog';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const columns = [
  { key: 'username', label: 'اسم المستخدم' },
  { key: 'branch', label: 'الفرع' },
  { key: 'status', label: 'الحالة' },
  { key: 'actions', label: 'إجراءات' },
] as const;

/** One shared login per branch: this form creates it or rewrites its credentials. */
function BranchLoginCredentialsCard() {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const branches = useQuery({
    queryKey: ['cashier-accounts', 'branches'],
    queryFn: () => fetchAllPages((page) => listCashierSessionBranches(page)),
  });

  const save = useMutation({
    mutationFn: upsertBranchCashier,
    onSuccess: async () => {
      setFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
    },
    onError: (error) => {
      if (error instanceof ApiError
        && Object.values(error.fieldErrors).some((messages) => messages?.length)) {
        setFieldErrors(error.fieldErrors as Record<string, string[]>);
        return;
      }
      setFieldErrors({ _: [serverErrorMessage(error) ?? 'تعذر حفظ بيانات الدخول'] });
    },
  });

  const submit = () => {
    const parsed = branchCashierCredentialsFormSchema.safeParse({
      branchId: branchId || undefined,
      username,
      password,
    });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }
    setFieldErrors({});
    save.mutate(parsed.data);
  };

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <p className="text-sm font-medium">بيانات دخول الفرع</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="branch-login-branch">فرع بيانات الدخول</Label>
            <Select
              id="branch-login-branch"
              disabled={branches.isPending || branches.isError}
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              <option value="">اختر الفرع</option>
              {(branches.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </Select>
            {fieldErrors.branchId ? <FieldError>{fieldErrors.branchId[0]}</FieldError> : null}
            {branches.isError ? (
              <div className="space-y-2">
                <FieldError>{serverErrorMessage(branches.error)}</FieldError>
                <Button variant="secondary" onClick={() => void branches.refetch()}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch-login-username">اسم المستخدم</Label>
            <Input
              id="branch-login-username"
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            {fieldErrors.username ? <FieldError>{fieldErrors.username[0]}</FieldError> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch-login-password">كلمة المرور</Label>
            <Input
              id="branch-login-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {fieldErrors.password ? <FieldError>{fieldErrors.password[0]}</FieldError> : null}
          </div>
        </div>
        {fieldErrors._ ? <FieldError>{fieldErrors._[0]}</FieldError> : null}
        <div className="border-t border-line/70 pt-4">
          <Button disabled={save.isPending} onClick={submit}>حفظ بيانات الدخول</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** The persistent shift roster: employees who may sell under the branch login. */
function BranchRosterCard() {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<number | undefined>();
  const [selected, setSelected] = useState<number[]>([]);

  const branches = useQuery({
    queryKey: ['cashier-accounts', 'branches'],
    queryFn: () => fetchAllPages((page) => listCashierSessionBranches(page)),
  });
  const roster = useQuery({
    queryKey: cashierAccountQueryKeys.roster(branchId ?? 0),
    queryFn: () => listBranchCashierRoster({ branchId: branchId! }),
    enabled: branchId !== undefined,
  });
  const employees = useQuery({
    queryKey: ['employees', 'options', 'active', branchId ?? null],
    queryFn: () => fetchAllPages((page) => listActiveEmployeeOptions(page, branchId)),
    enabled: branchId !== undefined,
  });

  // Re-seed the checkboxes whenever a fresh roster (or branch switch) arrives.
  const activeEmployeeIds = new Set((employees.data ?? []).map(({ id }) => id));
  const rosterKey = [
    branchId ?? '',
    roster.data?.map(({ id }) => id).join(',') ?? '',
    [...activeEmployeeIds].join(','),
  ].join(':');
  const [syncedRosterKey, setSyncedRosterKey] = useState('');
  if (roster.isSuccess && employees.isSuccess && rosterKey !== syncedRosterKey) {
    setSyncedRosterKey(rosterKey);
    setSelected(roster.data.map(({ id }) => id).filter((id) => activeEmployeeIds.has(id)));
  }

  const toggle = (employeeId: number) => {
    setSelected((current) => (
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    ));
  };

  const save = useMutation({
    mutationFn: () => replaceBranchCashierRoster(
      branchId!,
      selected.filter((id) => activeEmployeeIds.has(id)),
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: cashierAccountQueryKeys.roster(branchId!),
      });
    },
  });

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <p className="text-sm font-medium">وردية الفرع</p>
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="roster-branch">فرع الوردية</Label>
          <Select
            id="roster-branch"
            disabled={branches.isPending || branches.isError}
            value={branchId ?? ''}
            onChange={(event) => {
              setSelected([]);
              setBranchId(event.target.value ? Number(event.target.value) : undefined);
            }}
          >
            <option value="">اختر الفرع</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </Select>
          {branches.isError ? (
            <div className="space-y-2">
              <FieldError>{serverErrorMessage(branches.error)}</FieldError>
              <Button variant="secondary" onClick={() => void branches.refetch()}>
                إعادة المحاولة
              </Button>
            </div>
          ) : null}
        </div>

        {branchId === undefined ? null : roster.isPending || employees.isPending ? (
          <LoadingState label="جارٍ تحميل الوردية…" align="start" className="p-0" />
        ) : roster.isError || employees.isError ? (
          <div className="space-y-2">
            <FieldError>{serverErrorMessage(roster.error ?? employees.error)}</FieldError>
            <Button
              variant="secondary"
              onClick={() => void (roster.isError ? roster.refetch() : employees.refetch())}
            >
              إعادة المحاولة
            </Button>
          </div>
        ) : (employees.data ?? []).length === 0 ? (
          <EmptyState title="لا يوجد موظفون نشطون في هذا الفرع" />
        ) : (
          <ul className="space-y-1">
            {(employees.data ?? []).map((employee) => (
              <li key={employee.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-control border border-line px-3 py-2 text-sm hover:bg-surface">
                  <input
                    type="checkbox"
                    aria-label={employee.fullName}
                    className="size-4 accent-[color:var(--color-ink)]"
                    disabled={save.isPending}
                    checked={selected.includes(employee.id)}
                    onChange={() => toggle(employee.id)}                  />
                  {employee.fullName}
                </label>
              </li>
            ))}
          </ul>
        )}
        {save.error ? <FieldError>{serverErrorMessage(save.error)}</FieldError> : null}
        <div className="border-t border-line/70 pt-4">
          <Button
            disabled={branchId === undefined || !roster.isSuccess || !employees.isSuccess || save.isPending}
            onClick={() => save.mutate()}
          >
            حفظ وردية الفرع
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CashierAccountsView() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmDisable, setConfirmDisable] = useState<CashierAccount | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<CashierAccount | null>(null);

  const accountsQuery = useQuery({
    queryKey: cashierAccountQueryKeys.list({ page }),
    queryFn: () => listCashierAccounts({ page }),
  });

  const setStatus = useMutation({
    mutationFn: ({ accountId, active }: { accountId: number; active: boolean }) =>
      setCashierAccountStatus(accountId, active),
    onSuccess: async () => {
      setConfirmDisable(null);
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
    },
  });

  const items = accountsQuery.data?.items ?? [];
  const meta = accountsQuery.data?.meta;

  return (
    <section className="space-y-6">
      <PageHeader
        title="حسابات كاشير الفروع"
        description="حساب دخول واحد لكل فرع مع وردية الموظفين الذين يبيعون من خلاله."
      />

      <BranchLoginCredentialsCard />
      <BranchRosterCard />

      {setStatus.error ? (
        <FieldError>{serverErrorMessage(setStatus.error)}</FieldError>
      ) : null}

      <Card className="overflow-hidden shadow-card">
        {accountsQuery.isPending ? (
          <LoadingState label="جارٍ تحميل الحسابات…" className="px-6 py-16" />
        ) : accountsQuery.isError ? (
          <EmptyState
            title="تعذر تحميل الحسابات"
            description={serverErrorMessage(accountsQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void accountsQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد حسابات فروع بعد"
            description="ابدأ بحفظ بيانات دخول أحد الفروع من الأعلى."
          />
        ) : (
          <DataTable>
            <THead>
              {columns.map((column) => <TH key={column.key}>{column.label}</TH>)}
            </THead>
            <tbody>
              {items.map((account) => (
                <TR key={account.id}>
                  <TD className="font-medium">{account.username}</TD>
                  <TD className="text-muted">{account.branchName}</TD>
                  <TD>
                    {account.active ? (
                      <Badge variant="success">نشط</Badge>
                    ) : (
                      <Badge variant="neutral">معطل</Badge>
                    )}
                  </TD>
                  <TD>
                    <RowActions>
                      {account.active ? (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDisable(account)}>
                          تعطيل
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ accountId: account.id, active: true })}
                        >
                          تفعيل
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setResetPasswordTarget(account)}
                      >
                        <KeyRound className="size-4" aria-hidden />
                        إعادة تعيين كلمة المرور
                      </Button>
                    </RowActions>
                  </TD>
                </TR>
              ))}
            </tbody>
          </DataTable>
        )}

        {meta && meta.totalPages > 1 ? (
          <Pagination
            summary={(
              <>
                صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span>
                {' — '}
                <span className="tabular">{meta.total}</span> حساب
              </>
            )}
            previousDisabled={meta.page <= 1}
            nextDisabled={meta.page >= meta.totalPages}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </Card>

      {resetPasswordTarget ? (
        <ResetPasswordDialog
          accountId={resetPasswordTarget.id}
          username={resetPasswordTarget.username}
          onClose={() => setResetPasswordTarget(null)}
        />
      ) : null}

      {confirmDisable ? (
        <ConfirmDialog
          title="تعطيل حساب الكاشير"
          description={setStatus.isError
            ? serverErrorMessage(setStatus.error)
            : `سيُمنع ${confirmDisable.username} من تسجيل الدخول وتُلغى جلساته الحالية.`}
          confirmLabel="تأكيد التعطيل"
          tone="danger"
          pending={setStatus.isPending}
          onConfirm={() => setStatus.mutate({ accountId: confirmDisable.id, active: false })}
          onCancel={() => { setStatus.reset(); setConfirmDisable(null); }}
        />
      ) : null}
    </section>
  );
}

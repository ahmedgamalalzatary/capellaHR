'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge, Button, Card, ConfirmDialog, EmptyState } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { listActiveEmployeeOptions } from '../api/employee-options-api';
import { listCashierAccounts, setCashierAccountStatus, type CashierAccount } from '../api/cashier-accounts-api';
import { cashierAccountQueryKeys } from '../query-keys';
import { PromoteCashierForm } from './promote-cashier-form';
import { ResetPasswordDialog } from './reset-password-dialog';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const columns = [
  { key: 'username', label: 'اسم المستخدم' },
  { key: 'employee', label: 'الموظف' },
  { key: 'status', label: 'الحالة' },
  { key: 'actions', label: 'إجراءات' },
] as const;

export function CashierAccountsView() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<CashierAccount | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<CashierAccount | null>(null);

  const accountsQuery = useQuery({
    queryKey: cashierAccountQueryKeys.list({ page }),
    queryFn: () => listCashierAccounts({ page }),
  });

  const employeesQuery = useQuery({
    queryKey: ['employees', 'options', 'active'],
    queryFn: () => fetchAllPages((optionsPage) => listActiveEmployeeOptions(optionsPage)),
  });
  const employees = employeesQuery.data ?? [];
  const employeeLabel = (employeeId: number) =>
    employees.find((employee) => employee.id === employeeId)?.fullName ?? `#${employeeId}`;

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">حسابات الكاشير</h1>
          <p className="mt-1 text-sm text-muted">إنشاء حسابات التشغيل وإدارة وصولها بأمان.</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden />
          إنشاء حساب كاشير جديد
        </Button>
      </div>

      {createOpen ? (
        <PromoteCashierForm employees={employees} onDone={() => setCreateOpen(false)} />
      ) : null}

      {setStatus.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(setStatus.error)}
        </p>
      ) : null}

      <Card>
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
            title="لا يوجد حسابات كاشير بعد"
            description="ابدأ بإنشاء حساب كاشير لموظف نشط."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-2.5 text-start font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((account) => (
                  <tr key={account.id} className="border-b border-line/60 last:border-b-0">
                    <td className="px-4 py-3 font-medium">{account.username}</td>
                    <td className="px-4 py-3 text-muted">{employeeLabel(account.employeeId)}</td>
                    <td className="px-4 py-3">
                      {account.active ? (
                        <Badge variant="success">نشط</Badge>
                      ) : (
                        <Badge variant="neutral">معطل</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span>
            {' — '}
            <span className="tabular">{meta.total}</span> حساب
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              السابق
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              التالي
            </Button>
          </div>
        </div>
      ) : null}

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
    </div>
  );
}

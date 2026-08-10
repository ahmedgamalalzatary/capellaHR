'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge, Button, Card, ConfirmDialog, EmptyState } from '@capella/ui';

import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { PageHeader } from '@/components/layout/page-header';

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
    <section className="space-y-6">
      <PageHeader
        title="حسابات الكاشير"
        description="إنشاء حسابات التشغيل وإدارة وصولها بأمان."
        actions={(
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            إنشاء حساب كاشير جديد
          </Button>
        )}
      />

      {createOpen ? (
        <PromoteCashierForm employees={employees} onDone={() => setCreateOpen(false)} />
      ) : null}

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
            title="لا يوجد حسابات كاشير بعد"
            description="ابدأ بإنشاء حساب كاشير لموظف نشط."
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
                  <TD className="text-muted">{employeeLabel(account.employeeId)}</TD>
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

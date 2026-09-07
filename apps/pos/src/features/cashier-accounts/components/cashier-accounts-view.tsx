'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PencilLine, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, EmptyState } from '@capella/ui';
import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { PageHeader } from '@/components/layout/page-header';
import { ApiError } from '@/lib/api/client';
import { deleteCashierAccount, listCashierAccounts, setCashierAccountStatus, type CashierAccount } from '../api/cashier-accounts-api';
import { cashierAccountQueryKeys } from '../query-keys';
import { CashierAccountDialog } from './cashier-account-dialog';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const columns = [
  { key: 'username', label: 'اسم المستخدم' },
  { key: 'branch', label: 'الفرع' },
  { key: 'employees', label: 'الموظفون المسموح لهم بالبيع' },
  { key: 'status', label: 'الحالة' },
  { key: 'actions', label: 'إجراءات' },
] as const;

function AccountEmployees({ employees }: { employees: CashierAccount['employees'] }) {
  const names = employees.map(({ fullName }) => fullName);
  return <span className="block max-w-64 truncate text-muted" title={names.join('، ')}>{names.join('، ') || 'لا يوجد موظفون محددون'}</span>;
}

export function CashierAccountsView() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmDisable, setConfirmDisable] = useState<CashierAccount | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CashierAccount | null>(null);
  const [editingAccount, setEditingAccount] = useState<CashierAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const accountsQuery = useQuery({
    queryKey: cashierAccountQueryKeys.list({ page }),
    queryFn: () => listCashierAccounts({ page }),
  });

  const items = accountsQuery.data?.items ?? [];
  const meta = accountsQuery.data?.meta;

  const setStatus = useMutation({
    mutationFn: ({ accountId, active }: { accountId: number; active: boolean }) =>
      setCashierAccountStatus(accountId, active),
    onSuccess: async () => {
      setConfirmDisable(null);
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
    },
  });

  const remove = useMutation({
    mutationFn: (accountId: number) => deleteCashierAccount(accountId),
    onSuccess: async () => {
      setConfirmDelete(null);
      // Emptying a later page would otherwise refetch it and read as "no accounts".
      if (items.length === 1 && page > 1) setPage(page - 1);
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
    },
  });

  return (
    <section className="space-y-6">
      <PageHeader
        title="حسابات كاشير الفروع"
        description="إدارة حساب كل فرع والموظفين المسموح لهم بالبيع من خلاله."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />إضافة حساب كاشير</Button>}
      />

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
            description="أضف حساب كاشير وحدد الموظفين المسموح لهم بالبيع."
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
                  <TD><AccountEmployees employees={account.employees} /></TD>
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
                        onClick={() => setEditingAccount(account)}
                      >
                        <PencilLine className="size-4" aria-hidden />
                        تعديل
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { remove.reset(); setConfirmDelete(account); }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        حذف
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

      {creating || editingAccount ? (
        <CashierAccountDialog
          account={editingAccount}
          onClose={() => { setCreating(false); setEditingAccount(null); }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="حذف حساب الكاشير"
          description={remove.isError
            ? serverErrorMessage(remove.error)
            : `سيتوقف دخول ${confirmDelete.username} نهائيًا وتُلغى جلساته، ويصبح اسم المستخدم متاحًا من جديد. تبقى الفواتير والورديات المسجلة باسمه كما هي.`}
          confirmLabel="تأكيد الحذف"
          tone="danger"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id)}
          onCancel={() => { remove.reset(); setConfirmDelete(null); }}
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

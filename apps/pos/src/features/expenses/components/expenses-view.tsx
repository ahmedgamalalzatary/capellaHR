'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { DraftNotice } from '@/components/feedback/draft-notice';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { SuccessState } from '@/components/feedback/success-state';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { listCatalogBranches } from '@/features/catalog';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { useFormDraft } from '@/lib/form-draft';

import { correctExpense, createExpense, listExpenses, type Expense } from '../api/expenses-api';
import { expenseQueryKeys } from '../query-keys';

const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية. حاول مرة أخرى.';
const todayInCairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const kindLabel = (expense: Expense) => expense.kind === 'reversal' ? 'قيد عكسي' : expense.status === 'corrected' ? 'تم تصحيحه' : expense.supersedesId ? 'بديل تصحيح' : 'مصروف';
const kindTone = (expense: Expense) => expense.kind === 'reversal'
  ? 'warning' as const
  : expense.status === 'corrected'
    ? 'neutral' as const
    : 'success' as const;

export function ExpensesView() {
  const client = useQueryClient();
  /**
   * A cashier records, reads and corrects the spending of their own branch: the server pins
   * every request to the branch of their account, so there is no branch to choose.
   */
  const actor = useSession().data?.actor;
  const isAdmin = actor?.type === 'admin';
  const [branchId, setBranchId] = useState<number>();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(''); const [expenseDate, setExpenseDate] = useState(todayInCairo()); const [description, setDescription] = useState('');
  const [search, setSearch] = useState(''); const [fromDate, setFromDate] = useState(''); const [toDate, setToDate] = useState(''); const [status, setStatus] = useState<'' | 'active' | 'corrected'>(''); const [page, setPage] = useState(1);
  const [correcting, setCorrecting] = useState<Expense | null>(null); const [reason, setReason] = useState('');
  const [successMessage, setSuccessMessage] = useState<string>();
  const branches = useQuery({ queryKey: ['expense-branches'], queryFn: () => fetchAllPages((branchesPage) => listCatalogBranches(branchesPage)), enabled: isAdmin });
  /** An admin works one chosen branch at a time; a cashier waits only for the session to resolve. */
  const scopeReady = isAdmin ? branchId !== undefined : Boolean(actor);
  const branchScope = branchId === undefined ? {} : { branchId };
  const params = { ...branchScope, ...(search.trim() ? { search: search.trim() } : {}), ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}), ...(status ? { status } : {}), page, pageSize: 20 };
  const expenses = useQuery({ queryKey: expenseQueryKeys.list(params), queryFn: () => listExpenses(params), enabled: scopeReady });
  const refresh = () => invalidateErpCaches(client, 'expense');
  const create = useMutation({ mutationFn: () => createExpense({ ...branchScope, name: name.trim(), amount, expenseDate, description }), onSuccess: async () => { setName(''); setAmount(''); setDescription(''); setSuccessMessage('تم تسجيل المصروف.'); await refresh(); } });
  const correction = useMutation({ mutationFn: () => correctExpense(correcting!.id, { ...branchScope, name: name.trim(), amount, expenseDate, description, reason }), onSuccess: async () => { setCorrecting(null); setReason(''); setName(''); setAmount(''); setDescription(''); setSuccessMessage('تم تصحيح المصروف.'); await refresh(); } });
  const clearDraft = () => { setCorrecting(null); setName(''); setAmount(''); setExpenseDate(todayInCairo()); setDescription(''); setReason(''); create.reset(); correction.reset(); };
  const beginCorrection = (expense: Expense) => { create.reset(); correction.reset(); setCorrecting(expense); setName(expense.name); setAmount(expense.amount); setExpenseDate(expense.expenseDate); setDescription(expense.description); setReason(''); };
  /** Only a new expense is remembered; a correction is started from a stored row. */
  const draft = useFormDraft(
    correcting === null ? `expense:${branchId ?? 'own'}` : null,
    { name, amount, expenseDate, description },
    // Only typed wording or money counts as work; clearing them on save is what
    // retires the stored copy.
    name !== '' || amount !== '' || description !== '',
  );
  const canSubmit = scopeReady && name.trim() && amount && expenseDate;
  const commandPending = create.isPending || correction.isPending;
  const amountLabel = correcting ? 'المبلغ الصحيح' : 'المبلغ';

  return (
    <section className="space-y-6">
      <PageHeader
        title="المصروفات"
        description="سجل مصروفات الفروع وتصحيحها دون تغيير أو حذف التاريخ الأصلي."
      />
      {successMessage ? <SuccessState message={successMessage} /> : null}

      {isAdmin ? (
        <Card className="shadow-card">
          <CardContent className="p-4 sm:p-5">
            {branches.isError ? (
              <EmptyState
                title="تعذر تحميل الفروع"
                className="py-8"
                action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>}
              />
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="expense-branch">الفرع</Label>
                <Select
                  id="expense-branch"
                  className="max-w-sm"
                  value={branchId ?? ''}
                  disabled={commandPending}
                  onChange={(event) => {
                    if (commandPending) return;
                    setBranchId(event.target.value ? Number(event.target.value) : undefined);
                    clearDraft();
                    setSearch('');
                    setPage(1);
                  }}
                >
                  <option value="">اختر الفرع</option>
                  {branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!scopeReady ? (
        <Card className="shadow-card">
          {isAdmin
            ? <EmptyState title="اختر فرعًا لإدارة مصروفاته" />
            : <LoadingState label="جارٍ التحقق من الجلسة…" className="py-16" />}
        </Card>
      ) : (
        <>
          <Card className="shadow-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeading
                title={correcting ? `تصحيح مصروف #${correcting.id}` : 'تسجيل مصروف جديد'}
                description={correcting
                  ? 'يُسجَّل التصحيح كقيد جديد؛ القيد الأصلي يبقى في السجل.'
                  : 'الاسم والمبلغ والتاريخ مطلوبة لكل مصروف؛ الوصف اختياري.'}
              />
              {draft.pending ? (
                <DraftNotice
                  onRestore={() => {
                    const stored = draft.restore();
                    if (!stored) return;
                    setName(stored.name);
                    setAmount(stored.amount);
                    setExpenseDate(stored.expenseDate);
                    setDescription(stored.description);
                  }}
                  onDiscard={draft.discard}
                />
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="expense-name">اسم المصروف</Label>
                  <Input id="expense-name" aria-label="اسم المصروف" disabled={commandPending} value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-amount">{amountLabel}</Label>
                  <Input id="expense-amount" aria-label={amountLabel} inputMode="decimal" className="text-start" disabled={commandPending} value={amount} onChange={(event) => setAmount(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-date">تاريخ المصروف</Label>
                  <Input id="expense-date" aria-label="تاريخ المصروف" type="date" disabled={commandPending} value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-description">الوصف</Label>
                  <Input id="expense-description" aria-label="الوصف" disabled={commandPending} value={description} onChange={(event) => setDescription(event.target.value)} />
                </div>
                {correcting ? (
                  <div className="space-y-1.5 sm:col-span-2 xl:col-span-4">
                    <Label htmlFor="expense-reason">سبب التصحيح</Label>
                    <Input id="expense-reason" aria-label="سبب التصحيح" disabled={commandPending} value={reason} onChange={(event) => setReason(event.target.value)} />
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
                {correcting ? (
                  <>
                    <Button disabled={!canSubmit || !reason.trim() || correction.isPending} onClick={() => correction.mutate()}>تأكيد التصحيح</Button>
                    <Button variant="ghost" disabled={correction.isPending} onClick={clearDraft}>إلغاء</Button>
                  </>
                ) : (
                  <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>تسجيل المصروف</Button>
                )}
              </div>

              {(correcting ? correction.isError : create.isError) ? (
                <FieldError>{errorText(correcting ? correction.error : create.error)}</FieldError>
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeading title="تصفية السجل" />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="expense-search">بحث بالاسم أو الوصف</Label>
                  <Input id="expense-search" aria-label="بحث بالاسم أو الوصف" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-from">من تاريخ</Label>
                  <Input id="expense-from" aria-label="من تاريخ" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-to">إلى تاريخ</Label>
                  <Input id="expense-to" aria-label="إلى تاريخ" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-status">الحالة</Label>
                  <Select id="expense-status" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}>
                    <option value="">كل الحالات</option>
                    <option value="active">نشط</option>
                    <option value="corrected">تم تصحيحه</option>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-card">
            {expenses.isPending ? <LoadingState label="جارٍ تحميل المصروفات…" className="py-16" />
              : expenses.isError ? <EmptyState title="تعذر تحميل المصروفات" action={<Button onClick={() => void expenses.refetch()}>إعادة المحاولة</Button>} />
                : !expenses.data?.items.length ? <EmptyState title="لا توجد مصروفات" />
                  : (
                    <>
                      <DataTable>
                        <THead>
                          <TH>التاريخ</TH>
                          <TH>المصروف</TH>
                          <TH>الوصف</TH>
                          <TH numeric>المبلغ</TH>
                          <TH>الحالة والمنفذ</TH>
                          <TH>الإجراء</TH>
                        </THead>
                        <tbody>
                          {expenses.data.items.map((expense) => (
                            <TR key={expense.id}>
                              <TD className="tabular whitespace-nowrap text-muted">{expense.expenseDate}</TD>
                              <TD className="font-medium">{expense.name}</TD>
                              <TD>
                                {expense.description}
                                {expense.correctionReason ? <span className="block text-xs text-muted">السبب: {expense.correctionReason}</span> : null}
                              </TD>
                              <TD numeric className="whitespace-nowrap font-medium">
                                <span>{expense.kind === 'reversal' ? '-' : ''}{expense.amount}</span> ج.م
                              </TD>
                              <TD>
                                <Badge variant={kindTone(expense)}>{kindLabel(expense)}</Badge>
                                <span className="mt-1 block text-xs text-muted">
                                  {expense.actingUsername}{expense.reversalOfId ? ` · يعكس #${expense.reversalOfId}` : expense.supersedesId ? ` · بديل #${expense.supersedesId}` : ''}
                                </span>
                              </TD>
                              <TD>
                                {expense.kind === 'expense' && expense.status === 'active' ? (
                                  <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => beginCorrection(expense)}>تصحيح</Button>
                                ) : null}
                              </TD>
                            </TR>
                          ))}
                        </tbody>
                      </DataTable>
                      <Pagination
                        summary={<>صفحة <span className="tabular">{page}</span></>}
                        previousDisabled={page <= 1}
                        nextDisabled={page >= (expenses.data.meta.totalPages || 1)}
                        onPrevious={() => setPage((value) => value - 1)}
                        onNext={() => setPage((value) => value + 1)}
                      />
                    </>
                  )}
          </Card>
        </>
      )}
    </section>
  );
}

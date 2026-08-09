'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';
import { LoadingState } from '@/components/feedback/loading-state';
import { SuccessState } from '@/components/feedback/success-state';
import { listCatalogBranches, listCategories } from '@/features/catalog';
import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { correctExpense, createExpense, listExpenses, type Expense } from '../api/expenses-api';
import { expenseCategoryQueryKeys, expenseQueryKeys } from '../query-keys';

const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية. حاول مرة أخرى.';
const todayInCairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const kindLabel = (expense: Expense) => expense.kind === 'reversal' ? 'قيد عكسي' : expense.status === 'corrected' ? 'تم تصحيحه' : expense.supersedesId ? 'بديل تصحيح' : 'مصروف';

export function ExpensesView() {
  const client = useQueryClient();
  const [branchId, setBranchId] = useState<number>();
  const [categoryId, setCategoryId] = useState<number>();
  const [amount, setAmount] = useState(''); const [expenseDate, setExpenseDate] = useState(todayInCairo()); const [description, setDescription] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<number>(); const [fromDate, setFromDate] = useState(''); const [toDate, setToDate] = useState(''); const [status, setStatus] = useState<'' | 'active' | 'corrected'>(''); const [page, setPage] = useState(1);
  const [correcting, setCorrecting] = useState<Expense | null>(null); const [reason, setReason] = useState('');
  const [successMessage, setSuccessMessage] = useState<string>();
  const branches = useQuery({ queryKey: ['expense-branches'], queryFn: () => fetchAllPages((branchesPage) => listCatalogBranches(branchesPage)) });
  const activeCategories = useQuery({
    queryKey: expenseCategoryQueryKeys.active(branchId),
    queryFn: () => fetchAllPages((categoriesPage) => listCategories({ branchId: branchId!, type: 'expense', isActive: true, page: categoriesPage, pageSize: 100 })),
    enabled: branchId !== undefined,
  });
  const allCategories = useQuery({
    queryKey: expenseCategoryQueryKeys.forBranch(branchId),
    queryFn: () => fetchAllPages((categoriesPage) => listCategories({ branchId: branchId!, type: 'expense', page: categoriesPage, pageSize: 100 })),
    enabled: branchId !== undefined,
  });
  const params = { ...(branchId === undefined ? {} : { branchId }), ...(filterCategoryId ? { categoryId: filterCategoryId } : {}), ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}), ...(status ? { status } : {}), page, pageSize: 20 };
  const expenses = useQuery({ queryKey: expenseQueryKeys.list(params), queryFn: () => listExpenses(params), enabled: branchId !== undefined });
  const refresh = () => invalidateErpCaches(client, 'expense');
  const create = useMutation({ mutationFn: () => createExpense({ branchId, categoryId: categoryId!, amount, expenseDate, description }), onSuccess: async () => { setAmount(''); setDescription(''); setSuccessMessage('تم تسجيل المصروف.'); await refresh(); } });
  const correction = useMutation({ mutationFn: () => correctExpense(correcting!.id, { branchId, categoryId: categoryId!, amount, expenseDate, description, reason }), onSuccess: async () => { setCorrecting(null); setReason(''); setAmount(''); setDescription(''); setSuccessMessage('تم تصحيح المصروف.'); await refresh(); } });
  const clearDraft = () => { setCorrecting(null); setCategoryId(undefined); setAmount(''); setExpenseDate(todayInCairo()); setDescription(''); setReason(''); create.reset(); correction.reset(); };
  const beginCorrection = (expense: Expense) => { create.reset(); correction.reset(); setCorrecting(expense); setCategoryId(activeCategories.data?.some((category) => category.id === expense.categoryId) ? expense.categoryId : undefined); setAmount(expense.amount); setExpenseDate(expense.expenseDate); setDescription(expense.description); setReason(''); };
  const canSubmit = branchId && categoryId && amount && expenseDate && description.trim();
  const commandPending = create.isPending || correction.isPending;

  return <div className="mx-auto max-w-7xl space-y-4" dir="rtl">
    <div><h1 className="text-xl font-bold">المصروفات</h1><p className="text-sm text-muted">سجل مصروفات الفروع وتصحيحها دون تغيير أو حذف التاريخ الأصلي.</p></div>
    {successMessage ? <SuccessState message={successMessage} /> : null}
    {branches.isError ? <EmptyState title="تعذر تحميل الفروع" action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>} /> : <Label>الفرع<select className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={branchId ?? ''} disabled={commandPending} onChange={(event) => { if (commandPending) return; setBranchId(event.target.value ? Number(event.target.value) : undefined); clearDraft(); setFilterCategoryId(undefined); setPage(1); }}><option value="">اختر الفرع</option>{branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Label>}
    {branchId === undefined ? <EmptyState title="اختر فرعًا لإدارة مصروفاته" /> : <>
      <Card><CardContent className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-5">
        <Label>التصنيف<select aria-label="التصنيف" className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : undefined)} disabled={commandPending || activeCategories.isPending || activeCategories.isError}><option value="">اختر التصنيف</option>{activeCategories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Label>
        <Label>المبلغ<Input aria-label={correcting ? 'المبلغ الصحيح' : 'المبلغ'} inputMode="decimal" disabled={commandPending} value={amount} onChange={(event) => setAmount(event.target.value)} /></Label>
        <Label>تاريخ المصروف<Input aria-label="تاريخ المصروف" type="date" disabled={commandPending} value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></Label>
        <Label>الوصف<Input aria-label="الوصف" disabled={commandPending} value={description} onChange={(event) => setDescription(event.target.value)} /></Label>
        {correcting ? <Label>سبب التصحيح<Input aria-label="سبب التصحيح" disabled={commandPending} value={reason} onChange={(event) => setReason(event.target.value)} /></Label> : <div className="self-end"><Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>تسجيل المصروف</Button></div>}
        {correcting ? <div className="flex gap-2 md:col-span-2 xl:col-span-5"><Button disabled={!canSubmit || !reason.trim() || correction.isPending} onClick={() => correction.mutate()}>تأكيد التصحيح</Button><Button variant="ghost" disabled={correction.isPending} onClick={clearDraft}>إلغاء</Button></div> : null}
        {(correcting ? correction.isError : create.isError) ? <p role="alert" className="text-sm text-danger md:col-span-2 xl:col-span-5">{errorText(correcting ? correction.error : create.error)}</p> : null}
        {activeCategories.isError ? <EmptyState title="تعذر تحميل تصنيفات المصروفات" action={<Button onClick={() => void activeCategories.refetch()}>إعادة المحاولة</Button>} /> : null}
      </CardContent></Card>
      <Card><CardContent className="grid gap-3 pt-5 md:grid-cols-4">
        <Label>تصفية حسب التصنيف<select className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={filterCategoryId ?? ''} onChange={(event) => { setFilterCategoryId(event.target.value ? Number(event.target.value) : undefined); setPage(1); }} disabled={allCategories.isPending || allCategories.isError}><option value="">كل التصنيفات</option>{allCategories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Label>
        {allCategories.isError ? <EmptyState title="تعذر تحميل تصنيفات التصفية" action={<Button onClick={() => void allCategories.refetch()}>إعادة المحاولة</Button>} /> : null}
        <Label>من تاريخ<Input aria-label="من تاريخ" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></Label>
        <Label>إلى تاريخ<Input aria-label="إلى تاريخ" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></Label>
        <Label>الحالة<select className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="">كل الحالات</option><option value="active">نشط</option><option value="corrected">تم تصحيحه</option></select></Label>
      </CardContent></Card>
      <Card>{expenses.isPending ? <LoadingState label="جارٍ تحميل المصروفات…" /> : expenses.isError ? <EmptyState title="تعذر تحميل المصروفات" action={<Button onClick={() => void expenses.refetch()}>إعادة المحاولة</Button>} /> : !expenses.data?.items.length ? <EmptyState title="لا توجد مصروفات" /> : <><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line"><th className="p-3 text-start">التاريخ</th><th className="p-3 text-start">التصنيف</th><th className="p-3 text-start">الوصف</th><th className="p-3 text-start">المبلغ</th><th className="p-3 text-start">الحالة والمنفذ</th><th className="p-3 text-start">الإجراء</th></tr></thead><tbody>{expenses.data.items.map((expense) => <tr key={expense.id} className="border-b border-line/60"><td className="p-3">{expense.expenseDate}</td><td className="p-3">{expense.categoryName}</td><td className="p-3">{expense.description}{expense.correctionReason ? <span className="block text-xs text-muted">السبب: {expense.correctionReason}</span> : null}</td><td className="p-3" dir="ltr">{expense.kind === 'reversal' ? '-' : ''}{expense.amount} ج.م</td><td className="p-3">{kindLabel(expense)}<span className="block text-xs text-muted">{expense.actingUsername}{expense.reversalOfId ? ` · يعكس #${expense.reversalOfId}` : expense.supersedesId ? ` · بديل #${expense.supersedesId}` : ''}</span></td><td className="p-3">{expense.kind === 'expense' && expense.status === 'active' ? <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => beginCorrection(expense)}>تصحيح</Button> : null}</td></tr>)}</tbody></table></div><div className="flex justify-end gap-2 p-3"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span className="self-center text-sm">صفحة {page}</span><Button variant="ghost" disabled={page >= (expenses.data.meta.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>التالي</Button></div></>}</Card>
    </>}
  </div>;
}

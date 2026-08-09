'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  erpTabReportTypes,
  type ReportCell,
  type ReportFilters,
  type ReportType,
} from '@capella/contracts';
import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { listCashierSessionBranches } from '@/features/cashier-sessions';
import { fetchAllPages } from '@/lib/api/fetch-all';

import {
  createErpReportExport,
  deleteErpReportExportFile,
  downloadErpReportExport,
  listErpReportExports,
  retryErpReportExport,
  viewErpReport,
  type ErpReportExport,
} from '../api/erp-reports-api';
import { erpReportQueryKeys } from '../query-keys';

type ErpTabReportType = (typeof erpTabReportTypes)[number];

const tabLabels: Record<ErpTabReportType, string> = {
  'erp-sales': 'تقرير المبيعات',
  'erp-payment-methods': 'تقرير طرق الدفع',
  'erp-services': 'تقرير الخدمات',
  'erp-products': 'تقرير المنتجات',
  'erp-employees': 'تقرير الموظفين',
  'erp-commissions': 'تقرير العمولات',
  'erp-discounts': 'تقرير الخصومات',
  'erp-taxes': 'تقرير الضرائب',
  'erp-refunds': 'تقرير المرتجعات',
  'erp-voids': 'تقرير الإلغاءات',
  'erp-expenses': 'تقرير المصروفات',
  'erp-purchases': 'تقرير المشتريات',
  'erp-stock': 'تقرير المخزون',
  'erp-profit': 'تقرير الأرباح',
  'erp-client-history': 'تقرير سجل العملاء',
};

const summaryLabels: Record<string, string> = {
  totalRecords: 'إجمالي السجلات', totalSales: 'إجمالي المبيعات',
  totalDiscount: 'إجمالي الخصومات', totalTax: 'إجمالي الضرائب',
  totalQuantity: 'صافي الكمية', totalRevenue: 'صافي الإيراد',
  totalNetPayments: 'صافي المدفوعات', totalNetSales: 'صافي المبيعات',
  totalCommission: 'صافي العمولات', totalRefunds: 'إجمالي المرتجعات',
  totalVoids: 'إجمالي الإلغاءات', totalNetExpenses: 'صافي المصروفات',
  totalNetPurchases: 'صافي المشتريات', netQuantityChange: 'صافي تغير المخزون',
  totalCost: 'إجمالي التكلفة', totalProfit: 'إجمالي الربح',
};

const cairoDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
};

const initialDates = () => {
  const today = cairoDate(new Date());
  return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
};

const displayCell = (value: ReportCell) => {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  return String(value);
};

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : 'تعذر إكمال العملية. حاول مرة أخرى.';

type ExportStatusBadge = {
  label: string;
  variant: 'neutral' | 'warning' | 'success' | 'danger';
};

const exportStatusBadges: Partial<Record<ErpReportExport['status'], ExportStatusBadge>> = {
  queued: { label: 'في الانتظار', variant: 'neutral' as const },
  processing: { label: 'قيد الإنشاء', variant: 'warning' as const },
  completed: { label: 'مكتمل', variant: 'success' as const },
  failed: { label: 'فشل', variant: 'danger' as const },
};

const statusBadge = (status: ErpReportExport['status']): ExportStatusBadge => (
  exportStatusBadges[status] ?? { label: 'حالة غير معروفة', variant: 'neutral' }
);

function ExportHistory({ reportType }: { reportType: ErpTabReportType }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<number>();
  const query = useQuery({
    queryKey: [...erpReportQueryKeys.exports(reportType), page],
    queryFn: () => listErpReportExports({ reportType, page, pageSize: 20 }),
    refetchInterval: (result) => result.state.data?.items.some(
      ({ status }) => status === 'queued' || status === 'processing',
    ) ? 5_000 : false,
  });
  const invalidate = () => queryClient.invalidateQueries({
    queryKey: erpReportQueryKeys.exports(reportType),
  });
  const retry = useMutation({ mutationFn: retryErpReportExport, onSuccess: invalidate });
  const removeFile = useMutation({
    mutationFn: deleteErpReportExportFile,
    onSuccess: async () => { setConfirmDelete(undefined); await invalidate(); },
  });
  const download = useMutation({
    mutationFn: (record: ErpReportExport) => downloadErpReportExport(record.id),
    onSuccess: (blob, record) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${record.reportType}-report-${record.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
  const actionError = retry.error ?? removeFile.error ?? download.error;
  const items = query.data?.items ?? [];
  const meta = query.data?.meta;
  const deleteTarget = items.find(({ id }) => id === confirmDelete);

  return <section className="space-y-3" aria-labelledby="erp-export-history-title">
    <h2 id="erp-export-history-title" className="font-semibold">سجل تصدير التقرير الحالي</h2>
    {actionError ? <p role="alert" className="text-sm text-danger">{errorMessage(actionError)}</p> : null}
    <Card>{query.isPending ? <LoadingState label="جارٍ تحميل سجل التصدير…" className="p-6" />
      : query.isError ? <EmptyState title="تعذر تحميل سجل التصدير" action={<Button onClick={() => void query.refetch()}>إعادة المحاولة</Button>} />
        : !items.length ? <EmptyState title="لا توجد تصديرات لهذا التقرير" />
          : <ul className="divide-y divide-line/60">{items.map((record) => {
            const badge = statusBadge(record.status);
            return <li key={record.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <span className="font-medium">ملف #{record.id}</span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {record.fileDeletedAt ? <Badge variant="neutral">تم حذف الملف</Badge> : null}
              {record.rowCount !== null ? <span className="text-muted">{record.rowCount} سجل</span> : null}
              <span className="ms-auto flex flex-wrap gap-2">
                {record.status === 'failed' ? <Button size="sm" variant="ghost" disabled={retry.isPending} onClick={() => retry.mutate(record.id)}>إعادة محاولة التصدير</Button> : null}
                {record.status === 'completed' && !record.fileDeletedAt ? <>
                  <Button size="sm" variant="ghost" disabled={download.isPending} onClick={() => download.mutate(record)}>تنزيل PDF</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(record.id)}>حذف الملف</Button>
                </> : null}
              </span>
            </li>;
          })}</ul>}
    </Card>
    {deleteTarget ? <ConfirmDialog
      title="حذف ملف التصدير"
      description={removeFile.isError
        ? errorMessage(removeFile.error)
        : `سيُحذف ملف PDF رقم ${deleteTarget.id} نهائياً مع بقاء سجل التصدير.`}
      confirmLabel="تأكيد حذف الملف"
      tone="danger"
      pending={removeFile.isPending}
      onConfirm={() => removeFile.mutate(deleteTarget.id)}
      onCancel={() => { removeFile.reset(); setConfirmDelete(undefined); }}
    /> : null}
    {meta && meta.totalPages > 1 ? <div className="flex justify-end gap-2">
      <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button>
      <span className="self-center text-sm">صفحة {page}</span>
      <Button variant="ghost" disabled={page >= meta.totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button>
    </div> : null}
  </section>;
}

export function ErpReportsView() {
  const queryClient = useQueryClient();
  const dates = useMemo(initialDates, []);
  const [reportType, setReportType] = useState<ErpTabReportType>('erp-sales');
  const [branchInput, setBranchInput] = useState<number>();
  const [dateFromInput, setDateFromInput] = useState(dates.dateFrom);
  const [dateToInput, setDateToInput] = useState(dates.dateTo);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: dates.dateFrom, dateTo: dates.dateTo,
  });
  const [page, setPage] = useState(1);
  const branches = useQuery({
    queryKey: ['erp-reports', 'branches'],
    queryFn: () => fetchAllPages((branchPage) => listCashierSessionBranches(branchPage)),
  });
  const params = { ...filters, page, pageSize: 20 };
  const report = useQuery({
    queryKey: erpReportQueryKeys.view(reportType, params),
    queryFn: () => viewErpReport(reportType, params),
  });
  const createExport = useMutation({
    mutationFn: () => createErpReportExport({
      reportType, filters, selection: { mode: 'all' },
    }),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: erpReportQueryKeys.exports(reportType),
    }),
  });
  const applyFilters = () => {
    setFilters({
      ...(branchInput === undefined ? {} : { branchId: branchInput }),
      ...(dateFromInput ? { dateFrom: dateFromInput } : {}),
      ...(dateToInput ? { dateTo: dateToInput } : {}),
      ...(searchInput.trim() ? { search: searchInput.trim() } : {}),
    });
    setPage(1);
  };
  const snapshot = report.data?.snapshot;
  const meta = report.data?.meta;

  return <div className="mx-auto max-w-7xl space-y-4" dir="rtl">
    <div>
      <h1 className="text-2xl font-semibold text-ink">التقارير والتصدير</h1>
      <p className="mt-1 text-sm text-muted">عرض التقارير المالية والتشغيلية وإدارة ملفات PDF.</p>
    </div>
    <div role="tablist" aria-label="أنواع تقارير ERP" className="flex flex-wrap gap-2">
      {erpTabReportTypes.map((type) => <Button
        key={type}
        role="tab"
        variant={type === reportType ? 'primary' : 'secondary'}
        aria-selected={type === reportType}
        onClick={() => { setReportType(type); setPage(1); }}
      >{tabLabels[type]}</Button>)}
    </div>

    <Card><CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-5">
      <Label>الفرع<select aria-label="الفرع" value={branchInput ?? ''} onChange={(event) => setBranchInput(event.target.value ? Number(event.target.value) : undefined)} className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3">
        <option value="">كل الفروع</option>{branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></Label>
      <Label>من تاريخ<Input aria-label="من تاريخ" type="date" value={dateFromInput} onChange={(event) => setDateFromInput(event.target.value)} /></Label>
      <Label>إلى تاريخ<Input aria-label="إلى تاريخ" type="date" value={dateToInput} onChange={(event) => setDateToInput(event.target.value)} /></Label>
      <Label>بحث<Input aria-label="بحث" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></Label>
      <Button className="self-end" onClick={applyFilters}>تطبيق الفلاتر</Button>
    </CardContent></Card>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">{tabLabels[reportType]}</h2>
      <Button disabled={createExport.isPending} onClick={() => createExport.mutate()}>
        {createExport.isPending ? 'جارٍ وضع التصدير في الانتظار…' : 'تصدير PDF'}
      </Button>
    </div>
    {createExport.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(createExport.error)}</p> : null}

    <Card>{report.isPending ? <LoadingState label="جارٍ تحميل التقرير…" className="p-8" />
      : report.isError ? <EmptyState title="تعذر تحميل التقرير" description={errorMessage(report.error)} action={<Button onClick={() => void report.refetch()}>إعادة المحاولة</Button>} />
        : !snapshot?.rows.length ? <EmptyState title="لا توجد سجلات مطابقة" />
          : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-line text-muted">{snapshot.columns.map((column) => <th key={column.key} className="p-3 text-start">{column.label}</th>)}</tr></thead>
            <tbody>{snapshot.rows.map((row, index) => <tr key={String(row.id ?? index)} className="border-b border-line/60">{snapshot.columns.map((column) => <td key={column.key} className="p-3">{displayCell(row[column.key] ?? null)}</td>)}</tr>)}</tbody>
          </table></div>}
    </Card>

    {snapshot && Object.keys(snapshot.summary).length ? <Card><dl className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(snapshot.summary).map(([key, value]) => <div key={key} className="flex justify-between gap-4"><dt className="text-muted">{summaryLabels[key] ?? key}</dt><dd className="tabular">{displayCell(value)}</dd></div>)}</dl></Card> : null}

    {meta && meta.totalPages > 1 ? <div className="flex items-center justify-between text-sm">
      <span className="text-muted">صفحة {meta.page} من {meta.totalPages} — {meta.total} سجل</span>
      <div className="flex gap-2"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><Button variant="ghost" disabled={page >= meta.totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>
    </div> : null}

    <ExportHistory key={reportType} reportType={reportType} />
  </div>;
}

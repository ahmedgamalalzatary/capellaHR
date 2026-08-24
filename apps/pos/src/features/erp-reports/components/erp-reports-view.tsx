'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  erpTabReportTypes,
  type ReportCell,
  type ReportFilters,
  type ReportType,
} from '@capella/contracts';
import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
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
import { PrintSheet, type PrintableReport } from './print-sheet';

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
  'erp-receivables': 'تقرير أرصدة العملاء',
};

const summaryLabels: Record<string, string> = {
  totalBalanceDue: 'إجمالي الأرصدة المستحقة',
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

/** Every row behind the export, not just the page the screen happens to show. */
const collectReportRows = async (record: ErpReportExport) => {
  const first = await viewErpReport(record.reportType, { ...record.filters, page: 1, pageSize: 100 });
  const rows = [...first.snapshot.rows];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    rows.push(...(await viewErpReport(
      record.reportType, { ...record.filters, page, pageSize: 100 },
    )).snapshot.rows);
  }
  return { snapshot: first.snapshot, rows };
};

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
  const [sheet, setSheet] = useState<PrintableReport>();
  const print = useMutation({
    mutationFn: async (record: ErpReportExport) => ({
      report: await collectReportRows(record), record,
    }),
    onSuccess: ({ report, record }) => setSheet({
      title: tabLabels[record.reportType as ErpTabReportType] ?? report.snapshot.title,
      subtitle: [
        record.filters.dateFrom, record.filters.dateTo,
      ].filter(Boolean).join(' — ') || 'كل الفترات',
      columns: report.snapshot.columns,
      rows: report.rows,
      summary: Object.entries(report.snapshot.summary)
        .map(([key, value]) => ({ label: summaryLabels[key] ?? key, value })),
    }),
  });
  const actionError = retry.error ?? removeFile.error ?? download.error ?? print.error;
  const items = query.data?.items ?? [];
  const meta = query.data?.meta;
  const deleteTarget = items.find(({ id }) => id === confirmDelete);

  return (
    <section className="space-y-3" aria-labelledby="erp-export-history-title">
      <SectionHeading id="erp-export-history-title" title="سجل تصدير التقرير الحالي" />
      {actionError ? <FieldError>{errorMessage(actionError)}</FieldError> : null}
      <Card className="overflow-hidden shadow-card">
        {query.isPending ? <LoadingState label="جارٍ تحميل سجل التصدير…" className="py-16" />
          : query.isError ? <EmptyState title="تعذر تحميل سجل التصدير" action={<Button onClick={() => void query.refetch()}>إعادة المحاولة</Button>} />
            : !items.length ? <EmptyState title="لا توجد تصديرات لهذا التقرير" />
              : (
                <ul className="divide-y divide-line/60">
                  {items.map((record) => {
                    const badge = statusBadge(record.status);
                    return (
                      <li key={record.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="font-medium">ملف #{record.id}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {record.fileDeletedAt ? <Badge variant="neutral">تم حذف الملف</Badge> : null}
                        {record.rowCount !== null ? <span className="tabular text-muted">{record.rowCount} سجل</span> : null}
                        <span className="ms-auto flex flex-wrap gap-1">
                          {record.status === 'failed' ? (
                            <Button size="sm" variant="ghost" disabled={retry.isPending} onClick={() => retry.mutate(record.id)}>
                              <RotateCcw className="size-4" aria-hidden />
                              إعادة محاولة التصدير
                            </Button>
                          ) : null}
                          {record.status === 'completed' && !record.fileDeletedAt ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={print.isPending}
                                onClick={() => print.mutate(record)}
                              >
                                <Printer className="size-4" aria-hidden />
                                طباعة
                              </Button>
                              <Button size="sm" variant="ghost" disabled={download.isPending} onClick={() => download.mutate(record)}>
                                <Download className="size-4" aria-hidden />
                                تنزيل PDF
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(record.id)}>
                                <Trash2 className="size-4" aria-hidden />
                                حذف الملف
                              </Button>
                            </>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
        {meta && meta.totalPages > 1 ? (
          <Pagination
            summary={<>صفحة <span className="tabular">{page}</span></>}
            previousDisabled={page <= 1}
            nextDisabled={page >= meta.totalPages}
            onPrevious={() => setPage((value) => value - 1)}
            onNext={() => setPage((value) => value + 1)}
          />
        ) : null}
      </Card>
      {sheet ? <PrintSheet report={sheet} onPrinted={() => setSheet(undefined)} /> : null}
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
    </section>
  );
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

  return (
    <section className="space-y-6">
      <PageHeader
        title="التقارير والتصدير"
        description="عرض التقارير المالية والتشغيلية وإدارة ملفات PDF."
      />

      <div role="group" aria-label="أنواع تقارير ERP" className="flex flex-wrap gap-1.5">
        {erpTabReportTypes.map((type) => (
          <Button
            key={type}
            size="sm"
            variant={type === reportType ? 'primary' : 'secondary'}
            aria-pressed={type === reportType}
            onClick={() => { setReportType(type); setPage(1); }}
          >
            {tabLabels[type]}
          </Button>
        ))}
      </div>

      <Card className="shadow-card">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3 xl:grid-cols-5 xl:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="report-branch">الفرع</Label>
            <Select
              id="report-branch"
              aria-label="الفرع"
              value={branchInput ?? ''}
              onChange={(event) => setBranchInput(event.target.value ? Number(event.target.value) : undefined)}
            >
              <option value="">كل الفروع</option>
              {branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-from">من تاريخ</Label>
            <Input id="report-from" aria-label="من تاريخ" type="date" value={dateFromInput} onChange={(event) => setDateFromInput(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-to">إلى تاريخ</Label>
            <Input id="report-to" aria-label="إلى تاريخ" type="date" value={dateToInput} onChange={(event) => setDateToInput(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-search">بحث</Label>
            <Input id="report-search" aria-label="بحث" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
          </div>
          <Button onClick={applyFilters}>تطبيق الفلاتر</Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <SectionHeading
          title={tabLabels[reportType]}
          actions={(
            <Button size="sm" disabled={createExport.isPending} onClick={() => createExport.mutate()}>
              <Download className="size-4" aria-hidden />
              {createExport.isPending ? 'جارٍ وضع التصدير في الانتظار…' : 'تصدير PDF'}
            </Button>
          )}
        />
        {createExport.isError ? <FieldError>{errorMessage(createExport.error)}</FieldError> : null}

        <Card className="overflow-hidden shadow-card">
          {report.isPending ? <LoadingState label="جارٍ تحميل التقرير…" className="py-16" />
            : report.isError ? <EmptyState title="تعذر تحميل التقرير" description={errorMessage(report.error)} action={<Button onClick={() => void report.refetch()}>إعادة المحاولة</Button>} />
              : !snapshot?.rows.length ? <EmptyState title="لا توجد سجلات مطابقة" />
                : (
                  <DataTable>
                    <THead>
                      {snapshot.columns.map((column) => <TH key={column.key}>{column.label}</TH>)}
                    </THead>
                    <tbody>
                      {snapshot.rows.map((row, index) => (
                        <TR key={String(row.id ?? index)}>
                          {snapshot.columns.map((column) => (
                            <TD key={column.key} className="whitespace-nowrap">
                              {displayCell(row[column.key] ?? null)}
                            </TD>
                          ))}
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
                  <span className="tabular">{meta.total}</span> سجل
                </>
              )}
              previousDisabled={page <= 1}
              nextDisabled={page >= meta.totalPages}
              onPrevious={() => setPage((value) => value - 1)}
              onNext={() => setPage((value) => value + 1)}
            />
          ) : null}
        </Card>

        {snapshot && Object.keys(snapshot.summary).length ? (
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(snapshot.summary).map(([key, value]) => (
              <div key={key} className="rounded-card border border-line bg-paper p-3 shadow-card">
                <dt className="text-[12px] text-muted">{summaryLabels[key] ?? key}</dt>
                <dd className="tabular mt-1 text-base font-semibold text-ink">{displayCell(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <ExportHistory key={reportType} reportType={reportType} />
    </section>
  );
}

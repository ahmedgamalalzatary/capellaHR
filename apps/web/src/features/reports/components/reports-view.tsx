'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileDown, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge, Button, Card, EmptyState, Input } from '@capella/ui';

import type {
  CreateReportExportInput,
  ReportCell,
  ReportFilters,
  ReportType,
} from '@capella/contracts';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import {
  createReportExport,
  deleteReportExportFile,
  downloadReportExport,
  listReportExports,
  retryReportExport,
  viewReport,
  type ReportExport,
} from '../api/reports-api';
import { reportQueryKeys } from '../query-keys';

const REPORT_TABS: Array<{ type: ReportType; label: string }> = [
  { type: 'branches', label: 'الفروع' },
  { type: 'employees', label: 'الموظفون' },
  { type: 'devices', label: 'الأجهزة' },
  { type: 'shifts', label: 'الورديات' },
  { type: 'weekly-day-off', label: 'أيام الراحة' },
  { type: 'attendance', label: 'الحضور والغياب' },
  { type: 'payroll', label: 'الرواتب' },
  { type: 'bonuses', label: 'المكافآت' },
  { type: 'deductions', label: 'الخصومات' },
  { type: 'advances', label: 'السلف' },
];

const TAB_LABELS = Object.fromEntries(REPORT_TABS.map((tab) => [tab.type, tab.label])) as Record<
  ReportType,
  string
>;

/** Mirrors the locked per-tab filter compatibility from the contracts package. */
const MONTH_RANGE_TABS: ReadonlySet<ReportType> = new Set([
  'payroll',
  'bonuses',
  'deductions',
  'advances',
]);
const DATE_RANGE_TABS: ReadonlySet<ReportType> = new Set([
  'branches',
  'employees',
  'devices',
  'shifts',
  'weekly-day-off',
  'attendance',
  'bonuses',
  'deductions',
  'advances',
]);

/** Selection ids target the source table; shift rows are keyed by their employee. */
const idKeyOf = (reportType: ReportType) => (reportType === 'shifts' ? 'employeeId' : 'id');

const SUMMARY_LABELS: Record<string, string> = {
  totalRecords: 'إجمالي السجلات',
  activeRecords: 'سجلات نشطة',
  deletedRecords: 'سجلات محذوفة',
  revokedRecords: 'سجلات ملغاة',
  averageDurationMinutes: 'متوسط مدة الوردية بالدقائق',
  totalRequiredMinutes: 'إجمالي الدقائق المطلوبة',
  totalAmount: 'إجمالي المبلغ (ج.م)',
};

const EXPORT_STATUS: Record<
  ReportExport['status'],
  { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  queued: { label: 'في الانتظار', variant: 'neutral' },
  processing: { label: 'قيد المعالجة', variant: 'warning' },
  completed: { label: 'مكتمل', variant: 'success' },
  failed: { label: 'فشل', variant: 'danger' },
};

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const cellText = (value: ReportCell): string => {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  return String(value);
};

function ExportsHistory() {
  const queryClient = useQueryClient();
  const formatters = useDisplayFormatters();
  const formatDateTime = (value: string) =>
    formatters ? formatters.formatDateTime(value) : value;
  const [page, setPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const exportsQuery = useQuery({
    queryKey: [...reportQueryKeys.exports(), page],
    queryFn: () => listReportExports({ page }),
    // Keep the history live while background jobs are still running.
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) => item.status === 'queued' || item.status === 'processing',
      )
        ? 5000
        : false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: reportQueryKeys.exports() });
  const retry = useMutation({ mutationFn: (id: number) => retryReportExport(id), onSuccess: invalidate });
  const removeFile = useMutation({
    mutationFn: (id: number) => deleteReportExportFile(id),
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await invalidate();
    },
  });
  const download = useMutation({
    mutationFn: (record: ReportExport) => downloadReportExport(record.id),
    onSuccess: (blob, record) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${record.reportType}-report-${record.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking synchronously can cancel the download before it starts.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

  const actionError = retry.error ?? removeFile.error ?? download.error;
  const items = exportsQuery.data?.items ?? [];
  const meta = exportsQuery.data?.meta;

  return (
    <div className="space-y-3">
      <h2 className="text-[13px] font-medium">سجل التصديرات</h2>
      {actionError ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(actionError)}
        </p>
      ) : null}
      <Card>
        {exportsQuery.isPending ? (
          <div className="px-6 py-10 text-center text-sm text-muted">جارٍ تحميل سجل التصديرات…</div>
        ) : exportsQuery.isError ? (
          <EmptyState
            title="تعذر تحميل سجل التصديرات"
            description={serverErrorMessage(exportsQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void exportsQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد تصديرات بعد"
            description="تُنفذ تصديرات PDF في الخلفية وتظهر هنا فور إنشائها."
          />
        ) : (
          <ul className="divide-y divide-line/60">
            {items.map((record) => (
              <li
                key={record.id}
                data-testid={`export-${record.id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="font-medium">{TAB_LABELS[record.reportType]}</span>
                <Badge variant={EXPORT_STATUS[record.status].variant}>
                  {EXPORT_STATUS[record.status].label}
                </Badge>
                {record.fileDeletedAt !== null ? (
                  <Badge variant="neutral">تم حذف الملف</Badge>
                ) : null}
                <span className="text-[12px] text-muted" dir="ltr">
                  {formatDateTime(record.queuedAt)}
                </span>
                {record.rowCount !== null ? (
                  <span className="text-[12px] text-muted">
                    <span className="tabular">{record.rowCount}</span> سجل
                  </span>
                ) : null}
                <span className="ms-auto flex items-center gap-1">
                  {record.status === 'failed' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(record.id)}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      إعادة محاولة التصدير
                    </Button>
                  ) : null}
                  {record.status === 'completed' && record.fileDeletedAt === null ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={download.isPending}
                        onClick={() => download.mutate(record)}
                      >
                        <Download className="size-4" aria-hidden />
                        تنزيل PDF
                      </Button>
                      {confirmDeleteId === record.id ? (
                        <>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={removeFile.isPending}
                            onClick={() => removeFile.mutate(record.id)}
                          >
                            تأكيد الحذف
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            إلغاء
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(record.id)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                          حذف الملف
                        </Button>
                      )}
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            صفحة <span className="tabular">{meta.page}</span> من{' '}
            <span className="tabular">{meta.totalPages}</span>
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
    </div>
  );
}

export function ReportsView() {
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState<ReportType>('branches');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');
  const [assignmentType, setAssignmentType] = useState<'' | 'employee' | 'branch'>('');
  const [deviceStatus, setDeviceStatus] = useState<'' | 'active' | 'revoked'>('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());

  const resetForNewResults = () => {
    setPage(1);
    setSelectedIds(new Set());
  };
  const switchTab = (nextType: ReportType) => {
    setReportType(nextType);
    setSearchInput('');
    setSearch('');
    setBranchFilter(null);
    setDateFrom('');
    setDateTo('');
    setMonthFrom('');
    setMonthTo('');
    setAssignmentType('');
    setDeviceStatus('');
    resetForNewResults();
  };

  const filters: ReportFilters = {
    ...(search ? { search } : {}),
    ...(branchFilter !== null ? { branchId: branchFilter } : {}),
    ...(DATE_RANGE_TABS.has(reportType) && dateFrom ? { dateFrom } : {}),
    ...(DATE_RANGE_TABS.has(reportType) && dateTo ? { dateTo } : {}),
    ...(MONTH_RANGE_TABS.has(reportType) && monthFrom ? { monthFrom } : {}),
    ...(MONTH_RANGE_TABS.has(reportType) && monthTo ? { monthTo } : {}),
    ...(reportType === 'devices' && assignmentType
      ? { deviceAssignmentType: assignmentType }
      : {}),
    ...(reportType === 'devices' && deviceStatus ? { deviceStatus } : {}),
  };

  const reportQuery = useQuery({
    queryKey: reportQueryKeys.view(reportType, { ...filters, page }),
    queryFn: () => viewReport(reportType, { ...filters, page }),
  });

  const branchesQuery = useQuery({
    queryKey: branchQueryKeys.options(),
    queryFn: () => fetchAllPages((optionsPage) => listBranches({ page: optionsPage })),
  });
  const branches = branchesQuery.data ?? [];

  const exportReport = useMutation({
    mutationFn: (input: CreateReportExportInput) => createReportExport(input),
    onSuccess: async () => {
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: reportQueryKeys.exports() });
    },
  });

  const snapshot = reportQuery.data?.snapshot;
  const meta = reportQuery.data?.meta;
  const idKey = idKeyOf(reportType);

  const toggleSelected = (id: number) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const startExport = () =>
    exportReport.mutate({
      reportType,
      filters,
      selection:
        selectedIds.size > 0
          ? { mode: 'selected', ids: [...selectedIds] }
          : { mode: 'all' },
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="أنواع التقارير">
        {REPORT_TABS.map((tab) => (
          <Button
            key={tab.type}
            role="tab"
            aria-selected={reportType === tab.type}
            variant={reportType === tab.type ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => switchTab(tab.type)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            resetForNewResults();
            setSearch(searchInput.trim());
          }}
        >
          <Input
            type="search"
            aria-label="بحث في التقرير"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="ابحث في التقرير…"
            className="w-56"
          />
          <Button type="submit" variant="secondary" size="sm">
            <Search className="size-4" aria-hidden />
            بحث
          </Button>
        </form>
        <select
          aria-label="تصفية حسب الفرع"
          className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
          value={branchFilter ?? ''}
          onChange={(event) => {
            resetForNewResults();
            setBranchFilter(event.target.value === '' ? null : Number(event.target.value));
          }}
        >
          <option value="">كل الفروع</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
        {DATE_RANGE_TABS.has(reportType) ? (
          <>
            <label className="flex items-center gap-1 text-sm text-muted">
              من تاريخ
              <Input
                type="date"
                aria-label="من تاريخ"
                dir="ltr"
                className="w-40"
                value={dateFrom}
                onChange={(event) => {
                  resetForNewResults();
                  setDateFrom(event.target.value);
                }}
              />
            </label>
            <label className="flex items-center gap-1 text-sm text-muted">
              إلى تاريخ
              <Input
                type="date"
                aria-label="إلى تاريخ"
                dir="ltr"
                className="w-40"
                value={dateTo}
                onChange={(event) => {
                  resetForNewResults();
                  setDateTo(event.target.value);
                }}
              />
            </label>
          </>
        ) : null}
        {MONTH_RANGE_TABS.has(reportType) ? (
          <>
            <label className="flex items-center gap-1 text-sm text-muted">
              من شهر
              <Input
                type="month"
                aria-label="من شهر"
                dir="ltr"
                className="w-40"
                value={monthFrom}
                onChange={(event) => {
                  resetForNewResults();
                  setMonthFrom(event.target.value);
                }}
              />
            </label>
            <label className="flex items-center gap-1 text-sm text-muted">
              إلى شهر
              <Input
                type="month"
                aria-label="إلى شهر"
                dir="ltr"
                className="w-40"
                value={monthTo}
                onChange={(event) => {
                  resetForNewResults();
                  setMonthTo(event.target.value);
                }}
              />
            </label>
          </>
        ) : null}
        {reportType === 'devices' ? (
          <>
            <select
              aria-label="نوع التعيين"
              className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
              value={assignmentType}
              onChange={(event) => {
                resetForNewResults();
                setAssignmentType(event.target.value as '' | 'employee' | 'branch');
              }}
            >
              <option value="">كل التعيينات</option>
              <option value="employee">موظف</option>
              <option value="branch">فرع</option>
            </select>
            <select
              aria-label="حالة الجهاز"
              className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
              value={deviceStatus}
              onChange={(event) => {
                resetForNewResults();
                setDeviceStatus(event.target.value as '' | 'active' | 'revoked');
              }}
            >
              <option value="">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="revoked">ملغى</option>
            </select>
          </>
        ) : null}
        <Button
          size="sm"
          className="ms-auto"
          disabled={exportReport.isPending || reportQuery.isPending}
          onClick={startExport}
        >
          <FileDown className="size-4" aria-hidden />
          {selectedIds.size > 0 ? `تصدير المحدد (${selectedIds.size})` : 'تصدير PDF'}
        </Button>
      </div>

      <p className="text-[13px] text-muted">
        يُنشأ ملف PDF واحد مجمّع في الخلفية لكل تصدير ويظل متاحًا في سجل التصديرات حتى حذفه.
      </p>

      {exportReport.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(exportReport.error)}
        </p>
      ) : null}

      <Card>
        {reportQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل التقرير…</div>
        ) : reportQuery.isError ? (
          <EmptyState
            title="تعذر تحميل التقرير"
            description={serverErrorMessage(reportQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void reportQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : !snapshot || snapshot.rows.length === 0 ? (
          <EmptyState
            title="لا توجد سجلات مطابقة"
            description="عدّل الفلاتر أو الفترة للحصول على نتائج."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-3 py-2.5 text-start font-medium">تحديد</th>
                  {snapshot.columns.map((column) => (
                    <th key={column.key} className="px-4 py-2.5 text-start font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.map((row, index) => {
                  const rowId = typeof row[idKey] === 'number' ? (row[idKey] as number) : null;
                  return (
                    <tr key={rowId ?? index} className="border-b border-line/60 last:border-b-0">
                      <td className="px-3 py-3">
                        {rowId !== null ? (
                          <input
                            type="checkbox"
                            aria-label={`تحديد الصف ${rowId}`}
                            checked={selectedIds.has(rowId)}
                            onChange={() => toggleSelected(rowId)}
                          />
                        ) : null}
                      </td>
                      {snapshot.columns.map((column) => (
                        <td key={column.key} className="px-4 py-3">
                          <span className="tabular">{cellText(row[column.key] ?? null)}</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {snapshot && snapshot.rows.length > 0 ? (
        <Card>
          <dl className="grid gap-x-8 gap-y-2 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(snapshot.summary).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <dt className="text-muted">{SUMMARY_LABELS[key] ?? key}</dt>
                <dd className="tabular" dir="ltr">{cellText(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            صفحة <span className="tabular">{meta.page}</span> من{' '}
            <span className="tabular">{meta.totalPages}</span>
            {' — '}
            <span className="tabular">{meta.total}</span> سجل
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

      <ExportsHistory />
    </div>
  );
}

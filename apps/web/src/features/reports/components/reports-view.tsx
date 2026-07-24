'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Search } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, EmptyState, Input } from '@capella/ui';

import type {
  CreateReportExportInput,
  ReportFilters,
  ReportType,
} from '@capella/contracts';

import { fetchAllPages } from '@/lib/api/fetch-all';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import { createReportExport, viewReport } from '../api/reports-api';
import { reportQueryKeys } from '../query-keys';
import { ExportsHistory } from './exports-history';
import {
  cellText,
  DATE_RANGE_TABS,
  idKeyOf,
  MONTH_RANGE_TABS,
  REPORT_TABS,
  rowKeyOf,
  serverErrorMessage,
  SUMMARY_LABELS,
} from './reports-constants';

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
                    <tr key={rowKeyOf(reportType, row, index)} className="border-b border-line/60 last:border-b-0">
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
                <dd className="tabular">{cellText(value)}</dd>
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

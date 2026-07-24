'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge, Button, Card, EmptyState } from '@capella/ui';

import { useDisplayFormatters } from '@/providers/runtime-config';

import {
  deleteReportExportFile,
  downloadReportExport,
  listReportExports,
  retryReportExport,
  type ReportExport,
} from '../api/reports-api';
import { reportQueryKeys } from '../query-keys';
import { exportStatusBadge, serverErrorMessage, tabLabel } from './reports-constants';

export function ExportsHistory() {
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
                <span className="font-medium">{tabLabel(record.reportType)}</span>
                <Badge variant={exportStatusBadge(record.status).variant}>
                  {exportStatusBadge(record.status).label}
                </Badge>
                {record.fileDeletedAt !== null ? (
                  <Badge variant="neutral">تم حذف الملف</Badge>
                ) : null}
                <span className="text-[12px] text-muted">
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

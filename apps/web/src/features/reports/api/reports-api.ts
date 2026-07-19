import type {
  CreateReportExportInput,
  ReportExportStatus,
  ReportFilters,
  ReportSelection,
  ReportSnapshot,
  ReportType,
} from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

/** Export queue record as serialized over the wire (dates are ISO strings). */
export interface ReportExport {
  id: number;
  reportType: ReportType;
  status: ReportExportStatus;
  filters: ReportFilters;
  selection: ReportSelection;
  filePath: string | null;
  fileSha256: string | null;
  fileSizeBytes: number | null;
  rowCount: number | null;
  attemptCount: number;
  cycleAttemptCount: number;
  retryCount: number;
  failureReason: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  fileDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ViewReportParams extends ReportFilters {
  page?: number;
}

export function viewReport(
  reportType: ReportType,
  params: ViewReportParams = {},
): Promise<{ snapshot: ReportSnapshot; meta: PageMeta }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api
    .getWithMeta<ReportSnapshot>(`/reports/${reportType}${suffix}`)
    .then(({ data, meta }) => ({ snapshot: data, meta }));
}

export function createReportExport(input: CreateReportExportInput): Promise<ReportExport> {
  return api.post<ReportExport>('/reports/exports', input);
}

export interface ListReportExportsParams {
  reportType?: ReportType;
  status?: ReportExportStatus;
  page?: number;
}

export function listReportExports(
  params: ListReportExportsParams = {},
): Promise<{ items: ReportExport[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.reportType !== undefined) query.set('reportType', params.reportType);
  if (params.status !== undefined) query.set('status', params.status);
  if (params.page !== undefined) query.set('page', String(params.page));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<ReportExport>(`/reports/exports${suffix}`);
}

export function retryReportExport(id: number): Promise<ReportExport> {
  return api.post<ReportExport>(`/reports/exports/${id}/retry`);
}

/** Deletes the stored PDF only; the export history metadata is preserved. */
export function deleteReportExportFile(id: number): Promise<ReportExport> {
  return api.delete<ReportExport>(`/reports/exports/${id}/file`);
}

export function downloadReportExport(id: number): Promise<Blob> {
  return api.getBlob(`/reports/exports/${id}/download`);
}

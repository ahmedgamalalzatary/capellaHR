import type {
  CreateReportExportInput,
  ReportExportStatus,
  ReportFilters,
  ReportSelection,
  ReportSnapshot,
  ReportType,
} from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

export interface ErpReportExport {
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

export interface ViewErpReportParams extends ReportFilters { page?: number; pageSize?: number }

const queryString = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString() ? `?${query.toString()}` : '';
};

export async function viewErpReport(reportType: ReportType, params: ViewErpReportParams = {}) {
  const response = await api.getWithMeta<ReportSnapshot>(
    `/reports/${reportType}${queryString({ ...params, pageSize: params.pageSize ?? 20 })}`,
  );
  return { snapshot: response.data, meta: response.meta };
}

export const createErpReportExport = (input: CreateReportExportInput) => (
  api.post<ErpReportExport>('/reports/exports', input)
);

export function listErpReportExports(params: {
  reportType?: ReportType;
  status?: ReportExportStatus;
  page?: number;
  pageSize?: number;
} = {}) {
  return api.getPage<ErpReportExport>(`/reports/exports${queryString({
    ...params, pageSize: params.pageSize ?? 20,
  })}`);
}

export const retryErpReportExport = (id: number) => (
  api.post<ErpReportExport>(`/reports/exports/${id}/retry`)
);
export const getErpReportExport = (id: number) => (
  api.get<ErpReportExport>(`/reports/exports/${id}`)
);
export const downloadErpReportExport = (id: number) => (
  api.getBlob(`/reports/exports/${id}/download`)
);
export const deleteErpReportExportFile = (id: number) => (
  api.delete<ErpReportExport>(`/reports/exports/${id}/file`)
);

export type ErpReportPageMeta = PageMeta;

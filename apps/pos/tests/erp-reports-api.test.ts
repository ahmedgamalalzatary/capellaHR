import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), getWithMeta: vi.fn(), getPage: vi.fn(), post: vi.fn(), delete: vi.fn(), getBlob: vi.fn(),
}));
vi.mock('../src/lib/api/client', () => ({ api: mocks }));

import {
  createErpReportExport,
  deleteErpReportExportFile,
  downloadErpReportExport,
  getErpReportExport,
  listErpReportExports,
  retryErpReportExport,
  viewErpReport,
} from '../src/features/erp-reports/api/erp-reports-api';

beforeEach(() => vi.clearAllMocks());

describe('ERP reports API', () => {
  it('serializes branch, date, search, and pagination filters', async () => {
    mocks.getWithMeta.mockResolvedValue({ data: {}, meta: {} });
    await viewErpReport('erp-profit', {
      branchId: 2, dateFrom: '2026-08-01', dateTo: '2026-08-31', search: 'منتج', page: 3,
    });
    expect(mocks.getWithMeta).toHaveBeenCalledWith(
      '/reports/erp-profit?branchId=2&dateFrom=2026-08-01&dateTo=2026-08-31&search=%D9%85%D9%86%D8%AA%D8%AC&page=3&pageSize=20',
    );
  });

  it('uses the shared durable export lifecycle endpoints', async () => {
    const input = {
      reportType: 'erp-sales' as const,
      filters: { branchId: 2, dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      selection: { mode: 'all' as const },
    };
    await createErpReportExport(input);
    await listErpReportExports({ reportType: 'erp-sales', page: 2 });
    await retryErpReportExport(9);
    await getErpReportExport(9);
    await downloadErpReportExport(9);
    await deleteErpReportExportFile(9);

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/reports/exports', input);
    expect(mocks.getPage).toHaveBeenCalledWith('/reports/exports?reportType=erp-sales&page=2&pageSize=20');
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/reports/exports/9/retry');
    expect(mocks.get).toHaveBeenCalledWith('/reports/exports/9');
    expect(mocks.getBlob).toHaveBeenCalledWith('/reports/exports/9/download');
    expect(mocks.delete).toHaveBeenCalledWith('/reports/exports/9/file');
  });
});

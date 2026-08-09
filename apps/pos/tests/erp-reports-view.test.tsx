import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  view: vi.fn(), create: vi.fn(), listExports: vi.fn(), retry: vi.fn(),
  download: vi.fn(), deleteFile: vi.fn(), branches: vi.fn(),
}));
vi.mock('../src/features/erp-reports/api/erp-reports-api', () => ({
  viewErpReport: mocks.view,
  createErpReportExport: mocks.create,
  listErpReportExports: mocks.listExports,
  retryErpReportExport: mocks.retry,
  downloadErpReportExport: mocks.download,
  deleteErpReportExportFile: mocks.deleteFile,
}));
vi.mock('../src/features/cashier-sessions', () => ({
  listCashierSessionBranches: mocks.branches,
}));

import { ErpReportsView } from '../src/features/erp-reports/components/erp-reports-view';

const meta = { page: 1, pageSize: 20, total: 21, totalPages: 2 };
const snapshot = {
  reportType: 'erp-sales' as const,
  title: 'تقرير المبيعات',
  generatedAt: '2026-08-09T12:00:00.000Z',
  columns: [
    { key: 'invoiceNumber', label: 'رقم الفاتورة' },
    { key: 'clientName', label: 'العميل' },
    { key: 'total', label: 'الإجمالي' },
  ],
  rows: [{ invoiceNumber: 'INV.2026.08.09.0001', clientName: 'عميل التقرير', total: '230.00' }],
  summary: { totalRecords: 21, totalSales: '4830.00' },
};
const failedExport = {
  id: 9, reportType: 'erp-sales' as const, status: 'failed' as const,
  filters: { branchId: 2 }, selection: { mode: 'all' as const },
  filePath: null, fileSha256: null, fileSizeBytes: null, rowCount: null,
  attemptCount: 3, cycleAttemptCount: 3, retryCount: 0, failureReason: 'PDF_EXPORT_FAILED',
  queuedAt: '2026-08-09T12:00:00.000Z', startedAt: null, completedAt: null,
  failedAt: '2026-08-09T12:01:00.000Z', fileDeletedAt: null,
  createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:01:00.000Z',
};
const completedExport = {
  ...failedExport,
  id: 12,
  status: 'completed' as const,
  filePath: 'erp-reports/report-12.pdf',
  fileSha256: 'a'.repeat(64),
  fileSizeBytes: 1024,
  rowCount: 21,
  attemptCount: 1,
  cycleAttemptCount: 1,
  failureReason: null,
  completedAt: '2026-08-09T12:01:00.000Z',
  failedAt: null,
};

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })}>
      <ErpReportsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
  mocks.branches.mockResolvedValue({
    items: [{ id: 2, name: 'الفرع الرئيسي' }],
    meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
  mocks.view.mockResolvedValue({ snapshot, meta });
  mocks.listExports.mockResolvedValue({ items: [failedExport], meta: { ...meta, total: 1, totalPages: 1 } });
  mocks.create.mockResolvedValue({ ...failedExport, id: 10, status: 'queued' });
  mocks.retry.mockResolvedValue({ ...failedExport, status: 'queued' });
  mocks.download.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
  mocks.deleteFile.mockResolvedValue({ ...failedExport, fileDeletedAt: '2026-08-09T12:02:00.000Z' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ErpReportsView', () => {
  it('announces loading report data', async () => {
    mocks.view.mockReturnValue(new Promise(() => undefined));
    mount();

    expect(screen.getByRole('status', { name: 'جارٍ تحميل التقرير…' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'التقارير والتصدير' })).toBeDefined();
  });

  it('announces loading export history', () => {
    mocks.listExports.mockReturnValue(new Promise(() => undefined));
    mount();

    expect(screen.getByRole('status', { name: 'جارٍ تحميل سجل التصدير…' })).toBeDefined();
  });

  it('shows all report tabs and applies branch/date/search filters with full totals and pagination', async () => {
    mount();
    expect(await screen.findAllByRole('tab', { name: /تقرير/ })).toHaveLength(15);
    await screen.findByRole('option', { name: 'الفرع الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'عميل التقرير' } });
    fireEvent.click(screen.getByRole('button', { name: 'تطبيق الفلاتر' }));

    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith('erp-sales', {
      branchId: 2, dateFrom: '2026-08-01', dateTo: '2026-08-31',
      search: 'عميل التقرير', page: 1, pageSize: 20,
    }));
    const row = (await screen.findByText('INV.2026.08.09.0001')).closest('tr')!;
    expect(within(row).getByText('230.00')).toBeDefined();
    expect(screen.getByText('4830.00')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith(
      'erp-sales', expect.objectContaining({ page: 2 }),
    ));
  });

  it('creates filtered exports and retries failed jobs through the shared lifecycle', async () => {
    mount();
    await screen.findByText('INV.2026.08.09.0001');
    fireEvent.click(screen.getByRole('button', { name: 'تصدير PDF' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      reportType: 'erp-sales',
      filters: expect.objectContaining({ dateFrom: '2026-08-01', dateTo: '2026-08-09' }),
      selection: { mode: 'all' },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'إعادة محاولة التصدير' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith(9, expect.anything()));
  });

  it('renders a safe fallback badge for an unknown future export status', async () => {
    mocks.listExports.mockResolvedValueOnce({
      items: [{ ...failedExport, status: 'archived' }],
      meta: { ...meta, total: 1, totalPages: 1 },
    });

    mount();

    expect(await screen.findByText('حالة غير معروفة')).toBeDefined();
  });

  it('confirms file deletion in a locked dialog', async () => {
    mocks.listExports.mockResolvedValue({
      items: [completedExport], meta: { ...meta, total: 1, totalPages: 1 },
    });
    mocks.deleteFile.mockReturnValue(new Promise(() => undefined));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'حذف الملف' }));

    expect(mocks.deleteFile).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'حذف ملف التصدير' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد حذف الملف' }));
    await waitFor(() => expect(mocks.deleteFile).toHaveBeenCalledWith(12, expect.anything()));
    expect((within(dialog).getByRole('button', { name: 'تأكيد حذف الملف' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'إلغاء' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('resets export-history pagination when the report tab changes', async () => {
    mocks.listExports.mockResolvedValue({
      items: [failedExport], meta: { ...meta, total: 21, totalPages: 2 },
    });
    mount();
    await screen.findByRole('button', { name: 'إعادة محاولة التصدير' });
    const history = await screen.findByRole('heading', { name: 'سجل تصدير التقرير الحالي' });
    const section = history.closest('section')!;
    fireEvent.click(within(section).getByRole('button', { name: 'التالي' }));
    await waitFor(() => expect(mocks.listExports).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'erp-sales', page: 2,
    })));

    fireEvent.click(screen.getByRole('tab', { name: 'تقرير طرق الدفع' }));
    await waitFor(() => expect(mocks.listExports).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'erp-payment-methods', page: 1,
    })));
  });
});

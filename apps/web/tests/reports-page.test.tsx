import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  viewReport: vi.fn(),
  createReportExport: vi.fn(),
  listReportExports: vi.fn(),
  retryReportExport: vi.fn(),
  deleteReportExportFile: vi.fn(),
  downloadReportExport: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/reports/api/reports-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  viewReport: mocks.viewReport,
  createReportExport: mocks.createReportExport,
  listReportExports: mocks.listReportExports,
  retryReportExport: mocks.retryReportExport,
  deleteReportExportFile: mocks.deleteReportExportFile,
  downloadReportExport: mocks.downloadReportExport,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { ReportsView } from '../src/features/reports/components/reports-view';

const meta = { page: 1, pageSize: 20, total: 2, totalPages: 1 };

const branchesSnapshot = {
  reportType: 'branches',
  title: 'تقرير الفروع',
  generatedAt: '2026-07-19T10:00:00.000Z',
  columns: [
    { key: 'id', label: 'الرقم' },
    { key: 'name', label: 'الاسم' },
    { key: 'hasEverBeenReferenced', label: 'مرتبط بسجلات' },
  ],
  rows: [
    { id: 1, name: 'فرع القاهرة', hasEverBeenReferenced: true },
    { id: 2, name: 'فرع المعادى', hasEverBeenReferenced: false },
  ],
  summary: { totalRecords: 2 },
};

const bonusesSnapshot = {
  reportType: 'bonuses',
  title: 'تقرير المكافآت',
  generatedAt: '2026-07-19T10:00:00.000Z',
  columns: [
    { key: 'id', label: 'الرقم' },
    { key: 'employeeName', label: 'اسم الموظف' },
    { key: 'amount', label: 'المبلغ' },
  ],
  rows: [{ id: 5, employeeName: 'أحمد جمال', amount: '250.00' }],
  summary: { totalRecords: 1, totalAmount: 250 },
};

const completedExport = {
  id: 9,
  reportType: 'branches' as const,
  status: 'completed' as const,
  filters: {},
  selection: { mode: 'all' as const },
  filePath: 'uploads/reports/9.pdf',
  fileSha256: 'abc',
  fileSizeBytes: 2048,
  rowCount: 12,
  attemptCount: 1,
  cycleAttemptCount: 1,
  retryCount: 0,
  failureReason: null,
  queuedAt: '2026-07-19T09:00:00.000Z',
  startedAt: '2026-07-19T09:00:01.000Z',
  completedAt: '2026-07-19T09:00:05.000Z',
  failedAt: null,
  fileDeletedAt: null,
  createdAt: '2026-07-19T09:00:00.000Z',
  updatedAt: '2026-07-19T09:00:05.000Z',
};

const failedExport = {
  ...completedExport,
  id: 10,
  status: 'failed' as const,
  filePath: null,
  fileSha256: null,
  fileSizeBytes: null,
  rowCount: null,
  failureReason: 'PDF_EXPORT_FAILED',
  completedAt: null,
  failedAt: '2026-07-19T09:10:00.000Z',
};

const deletedFileExport = {
  ...completedExport,
  id: 11,
  filePath: null,
  fileDeletedAt: '2026-07-19T11:00:00.000Z',
};

const pageOf = (items: unknown[], extra: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...extra },
});

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.viewReport.mockResolvedValue({ snapshot: branchesSnapshot, meta });
  mocks.listReportExports.mockResolvedValue(
    pageOf([completedExport, failedExport, deletedFileExport]),
  );
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  // jsdom cannot navigate; the download anchor click must be inert.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const exportRow = (id: number) =>
  screen.getByTestId(`export-${id}`);

describe('ReportsView', () => {
  test('renders the branches report by default with dynamic columns, rows, and summary', async () => {
    renderView();
    expect(await screen.findByText('فرع المعادى')).toBeDefined();
    expect(screen.getByText('مرتبط بسجلات')).toBeDefined();
    expect(screen.getAllByText('نعم').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('لا').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('إجمالي السجلات')).toBeDefined();
    expect(mocks.viewReport).toHaveBeenCalledWith('branches', expect.objectContaining({ page: 1 }));
  });

  test('switching tabs requests that report type', async () => {
    renderView();
    await screen.findByText('فرع المعادى');
    mocks.viewReport.mockResolvedValue({
      snapshot: bonusesSnapshot,
      meta: { ...meta, total: 1 },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'المكافآت' }));
    await waitFor(() =>
      expect(mocks.viewReport).toHaveBeenLastCalledWith(
        'bonuses',
        expect.objectContaining({ page: 1 }),
      ),
    );
    expect(await screen.findByText('أحمد جمال')).toBeDefined();
  });

  test('passes search, branch, and date-range filters', async () => {
    renderView();
    await screen.findByText('فرع المعادى');
    fireEvent.change(await screen.findByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-07-19' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'القاهرة' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() =>
      expect(mocks.viewReport).toHaveBeenLastCalledWith(
        'branches',
        expect.objectContaining({
          search: 'القاهرة',
          branchId: 3,
          dateFrom: '2026-07-01',
          dateTo: '2026-07-19',
          page: 1,
        }),
      ),
    );
  });

  test('the payroll tab offers month-range filters instead of date filters', async () => {
    mocks.viewReport.mockResolvedValue({
      snapshot: { ...bonusesSnapshot, reportType: 'payroll', title: 'تقرير الرواتب' },
      meta: { ...meta, total: 1 },
    });
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'الرواتب' }));
    await screen.findByText('أحمد جمال');
    expect(screen.queryByLabelText('من تاريخ')).toBeNull();
    fireEvent.change(screen.getByLabelText('من شهر'), { target: { value: '2026-05' } });
    fireEvent.change(screen.getByLabelText('إلى شهر'), { target: { value: '2026-06' } });
    await waitFor(() =>
      expect(mocks.viewReport).toHaveBeenLastCalledWith(
        'payroll',
        expect.objectContaining({ monthFrom: '2026-05', monthTo: '2026-06', page: 1 }),
      ),
    );
  });

  test('exports all filtered records as a queued PDF job', async () => {
    mocks.createReportExport.mockResolvedValue({ ...completedExport, status: 'queued' });
    renderView();
    await screen.findByText('فرع المعادى');
    fireEvent.click(screen.getByRole('button', { name: 'تصدير PDF' }));
    await waitFor(() =>
      expect(mocks.createReportExport).toHaveBeenCalledWith({
        reportType: 'branches',
        filters: {},
        selection: { mode: 'all' },
      }),
    );
  });

  test('exports only the checked rows when a selection exists', async () => {
    mocks.createReportExport.mockResolvedValue({ ...completedExport, status: 'queued' });
    renderView();
    await screen.findByText('فرع المعادى');
    fireEvent.click(screen.getByRole('checkbox', { name: 'تحديد الصف 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'تصدير المحدد (1)' }));
    await waitFor(() =>
      expect(mocks.createReportExport).toHaveBeenCalledWith({
        reportType: 'branches',
        filters: {},
        selection: { mode: 'selected', ids: [1] },
      }),
    );
  });

  test('exports Attendance-dependent payroll rows by employee id even for an open preview', async () => {
    mocks.createReportExport.mockResolvedValue({ ...completedExport, status: 'queued' });
    mocks.viewReport.mockImplementation(async (reportType: string) => reportType === 'payroll'
      ? {
          snapshot: {
            reportType: 'payroll', title: 'تقرير الرواتب', generatedAt: '2026-07-19T10:00:00.000Z',
            columns: [
              { key: 'employeeId', label: 'رقم الموظف' },
              { key: 'employeeName', label: 'اسم الموظف' },
              { key: 'status', label: 'الحالة' },
            ],
            rows: [{ id: null, employeeId: 77, employeeName: 'موظف راتب مفتوح', status: 'open' }],
            summary: { totalRecords: 1 },
          },
          meta: { ...meta, total: 1 },
        }
      : { snapshot: branchesSnapshot, meta });
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'الرواتب' }));
    await screen.findByText('موظف راتب مفتوح');
    expect(screen.getByText('مفتوح')).toBeDefined();
    fireEvent.click(screen.getByRole('checkbox', { name: 'تحديد الصف 77' }));
    fireEvent.click(screen.getByRole('button', { name: 'تصدير المحدد (1)' }));

    await waitFor(() => expect(mocks.createReportExport).toHaveBeenCalledWith({
      reportType: 'payroll',
      filters: {},
      selection: { mode: 'selected', ids: [77] },
    }));
  });

  test('renders multiple Attendance rows for one employee without duplicate React keys', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.viewReport.mockImplementation(async (reportType: string) => reportType === 'attendance'
      ? {
          snapshot: {
            reportType: 'attendance', title: 'تقرير الحضور والغياب', generatedAt: '2026-07-19T10:00:00.000Z',
            columns: [
              { key: 'employeeName', label: 'اسم الموظف' },
              { key: 'attendanceDate', label: 'التاريخ' },
            ],
            rows: [
              { recordType: 'attendance', id: 1, employeeId: 77, employeeName: 'موظف متكرر', attendanceDate: '2026-07-18' },
              { recordType: 'daily_record', id: 1, employeeId: 77, employeeName: 'موظف متكرر', attendanceDate: '2026-07-19' },
            ],
            summary: { totalRecords: 2 },
          },
          meta,
        }
      : { snapshot: branchesSnapshot, meta });
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'الحضور والغياب' }));
    await screen.findByText('2026-07-19');

    expect(screen.getAllByRole('checkbox', { name: 'تحديد الصف 77' })).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key');
  });

  test('surfaces the Arabic error when a report source is unavailable', async () => {
    mocks.viewReport.mockRejectedValue(new ApiError(409, {
      code: 'REPORT_SOURCE_UNAVAILABLE',
      message: 'مصدر بيانات التقرير غير متاح حاليًا',
    }));
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'الحضور والغياب' }));
    expect(await screen.findByText('مصدر بيانات التقرير غير متاح حاليًا')).toBeDefined();
  });

  test('lists export history with status labels', async () => {
    renderView();
    await screen.findByText('فرع المعادى');
    expect(within(exportRow(9)).getByText('مكتمل')).toBeDefined();
    expect(within(exportRow(10)).getByText('فشل')).toBeDefined();
    expect(within(exportRow(11)).getByText('تم حذف الملف')).toBeDefined();
  });

  test('downloads a completed export as a PDF file', async () => {
    mocks.downloadReportExport.mockResolvedValue(new Blob(['pdf']));
    renderView();
    await screen.findByText('فرع المعادى');
    fireEvent.click(within(exportRow(9)).getByRole('button', { name: 'تنزيل PDF' }));
    await waitFor(() => expect(mocks.downloadReportExport).toHaveBeenCalledWith(9));
  });

  test('a deleted-file export offers no download or delete actions', async () => {
    renderView();
    await screen.findByText('فرع المعادى');
    expect(within(exportRow(11)).queryByRole('button', { name: 'تنزيل PDF' })).toBeNull();
    expect(within(exportRow(11)).queryByRole('button', { name: 'حذف الملف' })).toBeNull();
  });

  test('retries a failed export', async () => {
    mocks.retryReportExport.mockResolvedValue({ ...failedExport, status: 'queued' });
    renderView();
    await screen.findByText('فرع المعادى');
    fireEvent.click(within(exportRow(10)).getByRole('button', { name: 'إعادة محاولة التصدير' }));
    await waitFor(() => expect(mocks.retryReportExport).toHaveBeenCalledWith(10));
  });

  test('deletes a stored PDF only after an inline confirmation', async () => {
    mocks.deleteReportExportFile.mockResolvedValue(deletedFileExport);
    renderView();
    await screen.findByText('فرع المعادى');
    fireEvent.click(within(exportRow(9)).getByRole('button', { name: 'حذف الملف' }));
    expect(mocks.deleteReportExportFile).not.toHaveBeenCalled();
    fireEvent.click(within(exportRow(9)).getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(mocks.deleteReportExportFile).toHaveBeenCalledWith(9));
  });

  test('paginates report rows without sending a pageSize', async () => {
    mocks.viewReport.mockResolvedValue({
      snapshot: branchesSnapshot,
      meta: { ...meta, total: 40, totalPages: 2 },
    });
    renderView();
    await screen.findByText('فرع المعادى');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.viewReport.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });

  test('shows an empty state when the report has no rows', async () => {
    mocks.viewReport.mockResolvedValue({
      snapshot: { ...branchesSnapshot, rows: [], summary: { totalRecords: 0 } },
      meta: { ...meta, total: 0 },
    });
    renderView();
    expect(await screen.findByText('لا توجد سجلات مطابقة')).toBeDefined();
  });
});

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
    { key: 'id', label: 'المعرف' },
    { key: 'invoiceNumber', label: 'رقم الفاتورة' },
    { key: 'businessDate', label: 'تاريخ البيع' },
    { key: 'clientName', label: 'العميل' },
    { key: 'clientPhone', label: 'الهاتف' },
    { key: 'authorizedBy', label: 'المصرح' },
    { key: 'saleKind', label: 'النوع' },
    { key: 'employeeName', label: 'الموظف' },
    { key: 'total', label: 'الإجمالي' },
  ],
  rows: [{
    id: 41,
    invoiceNumber: 'INV.2026.08.09.0001',
    businessDate: '2026-09-09 08:03:54.315',
    clientName: 'عميل التقرير',
    clientPhone: '01000000000',
    authorizedBy: 'مدير',
    saleKind: 'بيع',
    total: '230.00',
  }],
  summary: {
    totalRecords: 21, totalSales: '4830.00',
    totalNetCashPayments: '3000.00', totalNetVisaPayments: '1830.00',
    totalMadeServices: 14, totalRefundedServices: 2,
    totalSoldProducts: 9, totalRefundedProducts: 1,
  },
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
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
  mocks.branches.mockResolvedValue({
    items: [{ id: 2, name: 'الفرع الرئيسي' }, { id: 3, name: 'فرع المعادي' }],
    meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
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
    const selector = await screen.findByRole('group', { name: 'أنواع تقارير ERP' });
    expect(within(selector).getAllByRole('button')).toHaveLength(21);
    expect(within(selector).getByRole('button', { name: 'تقرير التحويلات بين الفروع' })).toBeDefined();
    expect(within(selector).queryByRole('button', { name: 'تقرير الضرائب' })).toBeNull();
    expect(within(selector).getByRole('button', { name: 'الدفعات الجزئية' })).toBeDefined();
    expect(within(selector).queryByRole('button', { name: 'تقرير أرصدة العملاء' })).toBeNull();
    expect(within(selector).getByRole('button', { name: 'تقرير أرقام أدوار الخدمات' })).toBeDefined();
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
    const row = (await screen.findByText('عميل التقرير')).closest('tr')!;
    expect(within(row).getByText('230.00')).toBeDefined();
    expect(within(row).getByText('2026-09-09')).toBeDefined();
    expect(within(row).queryByText('INV.2026.08.09.0001')).toBeNull();
    expect(within(row).queryByText('01000000000')).toBeNull();
    expect(within(row).queryByText('مدير')).toBeNull();
    expect(within(row).queryByText('بيع')).toBeNull();
    expect(screen.getByText('4830.00')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith(
      'erp-sales', expect.objectContaining({ page: 2 }),
    ));
  });

  it('shows at most two sales employees and summarizes the rest', async () => {
    mocks.view.mockResolvedValue({
      snapshot: {
        ...snapshot,
        rows: [{
          ...snapshot.rows[0],
          employeeName: 'موظف أول | موظف ثان | موظف ثالث | موظف رابع',
        }],
      },
      meta: { ...meta, total: 1, totalPages: 1 },
    });
    mount();

    await screen.findByText('عميل التقرير');
    const salesRow = (await screen.findByText('عميل التقرير')).closest('tr')!;
    expect(within(salesRow).getByText('موظف أول, موظف ثان +2')).toBeDefined();
    expect(within(salesRow).queryByText('موظف ثالث')).toBeNull();
    expect(within(salesRow).queryByText('موظف رابع')).toBeNull();
  });

  it('applies date changes only after apply is clicked', async () => {
    mount();
    await screen.findByText('عميل التقرير');
    mocks.view.mockClear();
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-07-31' } });
    expect(mocks.view).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تطبيق الفلاتر' }));
    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith(
      'erp-sales', expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-31', page: 1 }),
    ));
  });

  it('rejects an inverted date range without discarding the draft dates', async () => {
    mount();
    await screen.findByText('عميل التقرير');
    mocks.view.mockClear();
    const from = screen.getByLabelText('من تاريخ') as HTMLInputElement;
    const to = screen.getByLabelText('إلى تاريخ') as HTMLInputElement;
    fireEvent.change(from, { target: { value: '2026-08-20' } });
    fireEvent.change(to, { target: { value: '2026-08-10' } });

    fireEvent.click(screen.getByRole('button', { name: 'تطبيق الفلاتر' }));

    expect(mocks.view).not.toHaveBeenCalled();
    expect(from.value).toBe('2026-08-20');
    expect(to.value).toBe('2026-08-10');
  });

  it('stages branch/date/search inputs until apply is clicked', async () => {
    mount();
    await screen.findByText('عميل التقرير');
    mocks.view.mockClear();

    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-07-31' } });
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'عميل جديد' } });

    expect(mocks.view).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'تطبيق الفلاتر' }));
    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith('erp-sales', {
      branchId: 2, dateFrom: '2026-07-01', dateTo: '2026-07-31',
      search: 'عميل جديد', page: 1, pageSize: 20,
    }));
  });

  it('carries applied filters when switching tabs without applying drafts', async () => {
    mount();
    await screen.findByText('عميل التقرير');
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'عميل التقرير' } });
    fireEvent.click(screen.getByRole('button', { name: 'تطبيق الفلاتر' }));
    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith('erp-sales', expect.objectContaining({
      branchId: 2, search: 'عميل التقرير',
    })));

    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'تقرير طرق الدفع' }));

    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith('erp-payment-methods', expect.objectContaining({
      branchId: 2, search: 'عميل التقرير', page: 1,
    })));
  });

  it('replaces the shared branch filter with independent from and to filters on transfers', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'تقرير التحويلات بين الفروع' }));

    expect(screen.queryByLabelText('الفرع')).toBeNull();
    fireEvent.change(screen.getByLabelText('من فرع'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('إلى فرع'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'تطبيق الفلاتر' }));

    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith(
      'erp-transfers', expect.objectContaining({
        sourceBranchId: 2, destinationBranchId: 3, page: 1,
      }),
    ));
  });

  it('restores the last report tab after leaving or refreshing the page', async () => {
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'تقرير المخزون' }));
    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith(
      'erp-stock', expect.anything(),
    ));
    first.unmount();

    mount();

    await waitFor(() => expect(screen.getByRole('button', { name: 'تقرير المخزون' })
      .getAttribute('aria-pressed')).toBe('true'));
    await waitFor(() => expect(mocks.view).toHaveBeenLastCalledWith(
      'erp-stock', expect.anything(),
    ));
  });

  it('creates filtered exports and retries failed jobs through the shared lifecycle', async () => {
    mount();
    await screen.findByText('عميل التقرير');
    fireEvent.click(screen.getByRole('button', { name: 'تصدير PDF' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      reportType: 'erp-sales',
      filters: expect.objectContaining({ dateFrom: '2026-08-01', dateTo: '2026-08-09' }),
      selection: { mode: 'all' },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'إعادة محاولة التصدير' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith(9, expect.anything()));
  });

  it('exports only selected report rows and clears selection when its scope changes', async () => {
    mount();
    await screen.findByText('عميل التقرير');

    fireEvent.click(screen.getByRole('checkbox', { name: 'تحديد الصف 41' }));
    fireEvent.click(screen.getByRole('button', { name: 'تصدير المحدد (1)' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'erp-sales', selection: { mode: 'selected', ids: [41] },
    })));
    await screen.findByRole('button', { name: 'تصدير PDF' });

    fireEvent.click(screen.getByRole('button', { name: 'تقرير طرق الدفع' }));
    expect(screen.getByRole('button', { name: 'تصدير PDF' })).toBeDefined();
  });

  it('renders report totals as dedicated table rows', async () => {
    mount();
    await screen.findByText('عميل التقرير');

    const totals = screen.getByTestId('report-totals');
    expect(within(totals).getByText('إجمالي السجلات')).toBeDefined();
    expect(within(totals).getByText('21')).toBeDefined();
    expect(within(totals).getByText('إجمالي المبيعات')).toBeDefined();
    expect(within(totals).getByText('4830.00')).toBeDefined();
    expect(within(totals).getByText('صافي المدفوع نقدي')).toBeDefined();
    expect(within(totals).getByText('3000.00')).toBeDefined();
    expect(within(totals).getByText('إجمالي الخدمات المنفذة')).toBeDefined();
    expect(within(totals).getByText('إجمالي المنتجات المباعة')).toBeDefined();
  });

  it.each([
    ['erp-services', 'تقرير الخدمات', 'خدمة تجريبية'],
    ['erp-products', 'تقرير المنتجات', 'منتج تجريبي'],
  ] as const)('marks combined %s rows and prevents selecting them as transactions', async (reportType, buttonName, itemName) => {
    mocks.view.mockResolvedValue({
      snapshot: {
        reportType,
        title: buttonName,
        generatedAt: '2026-08-09T12:00:00.000Z',
        columns: [
          { key: 'id', label: 'المعرف' },
          { key: itemName === 'خدمة تجريبية' ? 'serviceName' : 'productName', label: 'الصنف' },
          { key: 'rowType', label: 'نوع الصف' },
          { key: 'employeeName', label: 'الموظف' },
          { key: 'quantity', label: 'الكمية' },
          { key: 'amount', label: 'المبلغ' },
          { key: 'invoicePaid', label: 'المدفوع على الفاتورة' },
        ],
        rows: [
          { id: 'sale-1', [itemName === 'خدمة تجريبية' ? 'serviceName' : 'productName']: itemName, rowType: 'فردي', quantity: '1', amount: '50.00' },
          { id: `combined:${itemName}`, [itemName === 'خدمة تجريبية' ? 'serviceName' : 'productName']: itemName, rowType: 'مجمع', employeeName: 'موظف التقرير', quantity: '3', amount: '150.00', invoicePaid: '150.00' },
        ],
        summary: { totalRecords: 1, totalRevenue: '50.00' },
      },
      meta: { ...meta, total: 2, totalPages: 1 },
    });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: buttonName }));
    await screen.findAllByText(itemName);
    const combinedRow = document.querySelector<HTMLElement>('tr.report-combined-row')!;
    const combinedCells = within(combinedRow);
    expect(combinedCells.getAllByText(itemName)).toHaveLength(1);
    expect(combinedCells.getByText('3')).toBeDefined();
    expect(combinedCells.getAllByText('150.00')).toHaveLength(2);
    expect(combinedCells.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'نوع الصف' })).toBeNull();
    expect(combinedRow.classList.contains('report-combined-row')).toBe(true);
    expect(combinedRow.classList.contains('bg-black')).toBe(true);
    expect(combinedRow.classList.contains('text-white')).toBe(true);
    expect(combinedRow.classList.contains('[print-color-adjust:exact]')).toBe(true);
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

    fireEvent.click(screen.getByRole('button', { name: 'تقرير طرق الدفع' }));
    await waitFor(() => expect(mocks.listExports).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'erp-payment-methods', page: 1,
    })));
  });

  it('prints the report in place, with no new tab and no PDF the browser may download', async () => {
    mocks.listExports.mockResolvedValue({
      items: [completedExport], meta: { ...meta, total: 1, totalPages: 1 },
    });
    mocks.view.mockResolvedValue({ snapshot, meta: { ...meta, total: 1, totalPages: 1 } });
    const print = vi.fn();
    const open = vi.fn();
    vi.stubGlobal('print', print);
    vi.stubGlobal('open', open);
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'طباعة' }));

    // Printed from the export's own filters, not from whatever the screen shows.
    await waitFor(() => expect(mocks.view).toHaveBeenCalledWith('erp-sales', {
      branchId: 2, page: 1, pageSize: 100,
    }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const sheet = document.querySelector('#print-root')!;
    expect(sheet.textContent).toContain('تقرير المبيعات');
    expect(sheet.textContent).toContain('INV.2026.08.09.0001');
    expect(sheet.textContent).toContain('2026-09-09 08:03:54.315');
    expect(sheet.textContent).toContain('إجمالي المبيعات');
    // The app is stood down for the duration, so only the sheet reaches paper.
    expect(document.body.classList.contains('printing-report')).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('puts the screen back once the print dialog closes', async () => {
    mocks.listExports.mockResolvedValue({
      items: [completedExport], meta: { ...meta, total: 1, totalPages: 1 },
    });
    mocks.view.mockResolvedValue({ snapshot, meta: { ...meta, total: 1, totalPages: 1 } });
    vi.stubGlobal('print', vi.fn());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'طباعة' }));
    await waitFor(() => expect(document.querySelector('#print-root')).not.toBeNull());

    window.dispatchEvent(new Event('afterprint'));

    await waitFor(() => expect(document.querySelector('#print-root')).toBeNull());
    expect(document.body.classList.contains('printing-report')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('offers printing only for a file that is still on disk', async () => {
    mocks.listExports.mockResolvedValue({
      items: [
        { ...completedExport, fileDeletedAt: '2026-08-09T13:00:00.000Z' },
        failedExport,
      ],
      meta: { ...meta, total: 2, totalPages: 1 },
    });
    mount();
    await screen.findByRole('button', { name: 'إعادة محاولة التصدير' });

    expect(screen.queryByRole('button', { name: 'طباعة' })).toBeNull();
  });
});

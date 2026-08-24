import { saleFixtures } from '@capella/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';

const getInvoice = vi.hoisted(() => vi.fn());
const quoteRefund = vi.hoisted(() => vi.fn());
const refundInvoice = vi.hoisted(() => vi.fn());
const voidInvoice = vi.hoisted(() => vi.fn());
const reassignInvoiceLine = vi.hoisted(() => vi.fn());
const recordInvoicePayment = vi.hoisted(() => vi.fn());
const getCurrentCashierSession = vi.hoisted(() => vi.fn());
const listAssignableEmployees = vi.hoisted(() => vi.fn());
const reportExports = vi.hoisted(() => ({
  actor: { current: 'admin' as 'admin' | 'cashier' },
  create: vi.fn(), list: vi.fn(), get: vi.fn(), retry: vi.fn(), download: vi.fn(),
}));
const originalPrint = window.print;

vi.mock('../src/features/sales/api/sales-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getInvoice,
  quoteRefund,
  refundInvoice,
  voidInvoice,
  reassignInvoiceLine,
  recordInvoicePayment,
}));
vi.mock('../src/features/cashier-sessions', () => ({
  getCurrentCashierSession,
}));
vi.mock('../src/features/employee-assignment/api/assignable-employees-api', () => ({
  listAssignableEmployees,
}));
vi.mock('../src/features/auth', () => ({
  useSession: () => ({
    data: { actor: reportExports.actor.current === 'admin'
      ? { type: 'admin', accountId: 1 }
      : { type: 'cashier', accountId: 2, employeeId: 3 } },
  }),
}));
vi.mock('../src/features/erp-reports', () => ({
  createErpReportExport: reportExports.create,
  listErpReportExports: reportExports.list,
  getErpReportExport: reportExports.get,
  retryErpReportExport: reportExports.retry,
  downloadErpReportExport: reportExports.download,
}));

import { InvoiceReceiptView } from '../src/features/sales/components/invoice-receipt-view';

const renderView = (branchId: number | undefined = 2) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InvoiceReceiptView invoiceId={44} {...(branchId === undefined ? {} : { branchId })} />
    </QueryClientProvider>,
  );
  return queryClient;
};

/** The customer's own copy; employee copies repeat much of the same text. */
const customerReceipt = () => within(
  document.querySelector('[data-customer-receipt]') as HTMLElement,
);

describe('stored invoice receipt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getInvoice.mockReset().mockResolvedValue(saleFixtures.completedInvoice);
    quoteRefund.mockReset().mockResolvedValue({
      lines: [{
        invoiceLineId: saleFixtures.completedInvoice.lines[0].id,
        quantity: 1,
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      }],
      totals: { grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
      payments: [{ method: 'cash', refundableAmount: '185.00' }],
    });
    refundInvoice.mockReset().mockResolvedValue({
      ...saleFixtures.completedInvoice, status: 'refunded',
      eligibility: { canVoid: false, canRefund: false },
    });
    voidInvoice.mockReset().mockResolvedValue({
      ...saleFixtures.completedInvoice, status: 'voided',
      eligibility: { canVoid: false, canRefund: false },
    });
    listAssignableEmployees.mockReset().mockResolvedValue([{
      id: 11, employeeCode: 1011, fullName: 'هدى محمود', branchId: 2,
    }]);
    reassignInvoiceLine.mockReset().mockResolvedValue({
      ...saleFixtures.completedInvoice,
      lines: saleFixtures.completedInvoice.lines.map((line) => ({
        ...line,
        employee: { id: 11, employeeCode: 1011, name: 'هدى محمود' },
        reassignments: [{
          id: 91,
          fromEmployee: line.originalEmployee,
          toEmployee: { id: 11, employeeCode: 1011, name: 'هدى محمود' },
          reason: 'الموظفة المنفذة فعليًا',
          actingAccount: { id: 1, username: 'admin' },
          createdAt: '2026-08-03T12:00:00.000Z',
        }],
      })),
    });
    getCurrentCashierSession.mockReset().mockResolvedValue({ id: 14, branchId: 2 });
    recordInvoicePayment.mockReset();
    reportExports.actor.current = 'admin';
    const job = {
      id: 91, reportType: 'erp-invoice', status: 'queued', filters: { branchId: 2 },
      selection: { mode: 'selected', ids: [44] }, filePath: null, fileSha256: null,
      fileSizeBytes: null, rowCount: null, attemptCount: 0, cycleAttemptCount: 0,
      retryCount: 0, failureReason: null, queuedAt: '2026-08-09T12:00:00.000Z',
      startedAt: null, completedAt: null, failedAt: null, fileDeletedAt: null,
      createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
    };
    reportExports.create.mockReset().mockResolvedValue(job);
    reportExports.list.mockReset().mockResolvedValue({
      items: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    });
    reportExports.get.mockReset().mockResolvedValue({
      ...job, status: 'completed', filePath: 'reports/91.pdf', rowCount: 1,
      completedAt: '2026-08-09T12:01:00.000Z',
    });
    reportExports.retry.mockReset().mockResolvedValue(job);
    reportExports.download.mockReset().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
  });

  it('records a later payment on an open product invoice', async () => {
    const productLine = {
      ...saleFixtures.completedInvoice.lines[0], itemType: 'product' as const,
      sourceId: 31, employee: null, originalEmployee: null, reassignments: [],
      commissionRule: 'none' as const, commissionRate: '0.00', commissionAmount: '0.00',
      productCostBasis: '50.00',
    };
    const open = {
      ...saleFixtures.completedInvoice,
      lines: [productLine],
      totals: {
        ...saleFixtures.completedInvoice.totals,
        paymentTotal: '50.00', amountPaid: '50.00', creditedAmount: '0.00',
        balanceDue: '135.00', settlementStatus: 'open' as const,
      },
      payments: [{ method: 'cash' as const, amount: '50.00', refundedAmount: '0.00', refundableAmount: '50.00' }],
      eligibility: { canVoid: false, canRefund: true },
    };
    getInvoice.mockResolvedValue(open);
    recordInvoicePayment.mockResolvedValue({
      ...open,
      totals: { ...open.totals, paymentTotal: '185.00', amountPaid: '185.00', balanceDue: '0.00', settlementStatus: 'settled' },
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'تسجيل دفعة' }));
    fireEvent.change(screen.getByLabelText('المبلغ'), { target: { value: '135.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل وطباعة الدفعة' }));
    await waitFor(() => expect(recordInvoicePayment).toHaveBeenCalledWith(44, expect.objectContaining({
      branchId: 2, cashierSessionId: 14, method: 'cash', amount: '135.00',
    })));
    expect((await screen.findAllByText('إيصال دفعة')).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-payment-receipt]')).not.toBeNull();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    Object.defineProperty(window, 'print', { configurable: true, value: originalPrint });
  });

  it('announces the invoice loading state accessibly', () => {
    getInvoice.mockReturnValueOnce(new Promise(() => undefined));

    renderView();

    expect(screen.getByRole('status', { name: 'جارٍ تحميل الفاتورة…' })).toBeDefined();
  });

  it('renders every required stored fact and prints without submitting a sale', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderView();

    expect(await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber)).toBeDefined();
    expect(screen.getByText(saleFixtures.completedInvoice.client.name)).toBeDefined();
    expect(screen.getAllByText(saleFixtures.completedInvoice.lines[0].employee.name).length)
      .toBeGreaterThan(0);
    expect(customerReceipt().getByText(new RegExp(saleFixtures.completedInvoice.lines[0].name)))
      .toBeDefined();
    expect(screen.getByText('الكاشير')).toBeDefined();
    expect(screen.getByText(saleFixtures.completedInvoice.seller.name)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));
    expect(print).toHaveBeenCalledOnce();
    expect(getInvoice).toHaveBeenCalledTimes(1);
    expect(getInvoice).toHaveBeenCalledWith(44, 2);
  });

  it('reassigns a service to a present employee and retains the original on the receipt', async () => {
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    fireEvent.click(screen.getByRole('button', { name: 'تغيير الموظف' }));
    fireEvent.click(await screen.findByRole('button', { name: /هدى محمود/ }));
    fireEvent.change(screen.getByLabelText('سبب التغيير'), {
      target: { value: 'الموظفة المنفذة فعليًا' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد التغيير' }));

    await waitFor(() => expect(reassignInvoiceLine).toHaveBeenCalledWith(44, 81, {
      branchId: 2,
      employeeId: 11,
      operationReference: expect.any(String),
      reason: 'الموظفة المنفذة فعليًا',
    }));
    expect(await screen.findAllByText('هدى محمود')).not.toHaveLength(0);
    expect(screen.getAllByText(/مُسند أصلاً إلى/).length).toBeGreaterThan(0);
  });

  it('falls back to the authorizing account for legacy invoices without a seller', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      seller: null,
    });
    renderView();

    expect(await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber)).toBeDefined();
    expect(screen.getByText('بواسطة')).toBeDefined();
    expect(screen.getByText(saleFixtures.completedInvoice.authorizedBy.username)).toBeDefined();
    expect(screen.queryByText('الكاشير')).toBeNull();
  });

  it('brands the receipt header and encodes the invoice number as a QR code', async () => {
    const toString = vi.spyOn(QRCode, 'toString');
    renderView();

    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    await waitFor(() => expect(toString).toHaveBeenCalledWith(
      saleFixtures.completedInvoice.invoiceNumber,
      expect.objectContaining({ type: 'svg' }),
    ));
    expect(screen.getByTestId('receipt-qr').innerHTML).toContain('svg');
    expect(customerReceipt().getByText('Capella Care')).toBeDefined();
    expect(screen.getByText('إيصال بيع')).toBeDefined();
    expect(customerReceipt().getByText('رقم الفاتورة')).toBeDefined();
    expect(customerReceipt().getByText('التاريخ')).toBeDefined();
    expect(document.querySelector('[data-receipt]')).not.toBeNull();
  });

  it('lays out every sold line in a priced quantity table', async () => {
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    const table = customerReceipt().getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['الصنف', 'عدد', 'سعر', 'قيمة']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['صبغة شعر', '1', '200.00', '200.00']);
  });

  it('prints the counter contact details and the consumer-protection return policy', async () => {
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(customerReceipt().getByText('Capella Care')).toBeDefined();
    expect(customerReceipt().getByText(/01034660596/)).toBeDefined();
    expect(customerReceipt().getByText('www.capellacares.com')).toBeDefined();
    expect(customerReceipt()
      .getByText('سياسة الاستبدال والاسترجاع طبقًا لقانون حماية المستهلك')).toBeDefined();
    expect(customerReceipt().getByText(/خلال 14 يوم/)).toBeDefined();
    expect(customerReceipt().getByText(/19588/)).toBeDefined();
  });

  it('summarizes item counts, discount and tax with an emphasized final total', async () => {
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(screen.getByText('عدد الأصناف').parentElement?.textContent).toContain('1');
    expect(screen.getByText('إجمالي الكميات').parentElement?.textContent).toContain('1');
    expect(customerReceipt().getByText('المجموع الفرعي').parentElement?.textContent)
      .toContain('200.00');
    expect(customerReceipt().getByText('الخصم').parentElement?.textContent).toContain('20.00');
    expect(customerReceipt().getByText('الضريبة').parentElement?.textContent).toContain('5.00');
    const grandTotal = screen.getByText('الإجمالي النهائي').parentElement;
    expect(grandTotal?.textContent).toContain('185.00');
    expect(grandTotal?.hasAttribute('data-grand-total')).toBe(true);
  });

  it('hides the discount and tax rows when the sale carries none', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      discount: null,
      tax: null,
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(customerReceipt().queryByText('الخصم')).toBeNull();
    expect(customerReceipt().queryByText('الضريبة')).toBeNull();
    expect(screen.getByText('الإجمالي النهائي').parentElement?.textContent).toContain('185.00');
  });

  it('lists tenders with a paid total under the reversal-ready payment rows', async () => {
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(screen.getByText('نقدي').parentElement?.textContent).toContain('185.00');
    expect(screen.getByText('المدفوع').parentElement?.textContent).toContain('185.00');
    expect(customerReceipt().getByText('شكرًا لزيارتكم')).toBeDefined();
  });

  it('leaves refunding to the refunds tab and keeps the receipt page void-only', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(screen.queryByRole('button', { name: 'استرداد' })).toBeNull();
    expect(screen.getByRole('button', { name: 'إلغاء الفاتورة' })).toBeDefined();
  });

  it('labels a product-only receipt as having no assigned employee', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      lines: [{ ...saleFixtures.completedInvoice.lines[0]!, itemType: 'product', employee: null }],
    });

    renderView();

    expect(await screen.findByText('بدون موظف')).toBeDefined();
    // Nobody performed anything, so there is no employee copy to print.
    expect(document.querySelectorAll('[data-employee-receipt]')).toHaveLength(0);
  });

  it('prints one employee copy per employee beside the customer receipt', async () => {
    const [line] = saleFixtures.completedInvoice.lines;
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      lines: [
        line,
        { ...line, id: 82, lineNumber: 2, name: 'قص شعر' },
        {
          ...line,
          id: 83,
          lineNumber: 3,
          name: 'مانيكير',
          employee: { id: 11, employeeCode: 1011, name: 'هدى محمود' },
        },
      ],
      totals: {
        subtotal: '600.00', discountAmount: '60.00', taxAmount: '5.00',
        total: '545.00', paymentTotal: '545.00',
      },
      discount: { kind: 'percentage', value: '10.00', amount: '60.00' },
      payments: [{
        method: 'cash', amount: '545.00', refundedAmount: '0.00', refundableAmount: '545.00',
      }],
    });

    renderView();

    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    const copies = [...document.querySelectorAll('[data-employee-receipt]')];
    expect(copies).toHaveLength(2);
    // Each copy carries only that employee's own lines and their own share.
    expect(within(copies[0] as HTMLElement).getByText('سارة علي')).toBeDefined();
    expect(within(copies[0] as HTMLElement).getByText('قص شعر')).toBeDefined();
    expect(within(copies[0] as HTMLElement).queryByText('مانيكير')).toBeNull();
    // 400 of the 600 subtotal: 40 of the discount and 3.33 of the tax, exactly.
    expect(within(copies[0] as HTMLElement).getByText('363.33 ج.م')).toBeDefined();
    expect(within(copies[1] as HTMLElement).getByText('هدى محمود')).toBeDefined();
    expect(within(copies[1] as HTMLElement).getByText('مانيكير')).toBeDefined();
    expect(within(copies[1] as HTMLElement).getByText('181.67 ج.م')).toBeDefined();
  });

  it('keeps the receipt clean of per-tender refund balances and shows immutable reversal details', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      status: 'partially_refunded',
      lines: saleFixtures.completedInvoice.lines.map((line) => ({
        ...line, refundedQuantity: 1, refundableQuantity: 0,
      })),
      payments: [{
        method: 'cash', amount: '185.00', refundedAmount: '185.00', refundableAmount: '0.00',
      }],
      reversals: [{
        id: 71,
        type: 'refund',
        reason: 'عدم رضا العميل',
        actingAccount: { id: 3, username: 'cashier.one' },
        approvingAccount: null,
        totals: {
          grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
        },
        lines: [{
          invoiceLineId: 81, lineNumber: 1, itemType: 'service', name: 'صبغة شعر', quantity: 1,
          grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
        }],
        payments: [{ method: 'cash', amount: '185.00' }],
        createdAt: '2026-08-04T09:00:00.000Z',
      }],
      eligibility: { canVoid: false, canRefund: false },
    });
    renderView();

    expect(await screen.findByText('سجل الإلغاء والاسترداد')).toBeDefined();
    expect(screen.queryByText(/تم استرداد [\d.]+ ج\.م · متبقي [\d.]+ ج\.م/)).toBeNull();
    expect(screen.getByText('صبغة شعر × 1 · 185.00 ج.م')).toBeDefined();
    expect(screen.getByText('نقدي · 185.00 ج.م')).toBeDefined();
  });

  it('requires a reason and confirms an eligible same-day full void', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    expect((screen.getByRole('button', { name: 'تأكيد الإلغاء' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith(44, expect.objectContaining({
      branchId: 2, reason: 'إدخال مكرر', idempotencyKey: expect.any(String),
    })));
  });

  it('reuses the idempotency key when an unchanged void submission is retried', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    voidInvoice.mockRejectedValueOnce(new Error('network timeout'));
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });

    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));

    await waitFor(() => expect(voidInvoice).toHaveBeenCalledTimes(2));
    expect(voidInvoice.mock.calls[1]![1].idempotencyKey)
      .toBe(voidInvoice.mock.calls[0]![1].idempotencyKey);
  });

  it('lets an Admin queue and download the stored invoice through the report worker', async () => {
    const createObjectURL = vi.fn(() => 'blob:invoice');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    fireEvent.click(screen.getByRole('button', { name: 'إنشاء PDF A4' }));
    await waitFor(() => expect(reportExports.create).toHaveBeenCalledWith({
      reportType: 'erp-invoice',
      filters: { branchId: 2 },
      selection: { mode: 'selected', ids: [44] },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'تنزيل PDF A4' }));
    await waitFor(() => expect(reportExports.download).toHaveBeenCalledWith(91));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('does not expose invoice PDF exports to a Cashier', async () => {
    reportExports.actor.current = 'cashier';
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(screen.queryByRole('button', { name: 'إنشاء PDF A4' })).toBeNull();
  });

  it('recovers an existing invoice export after navigation without enqueueing a duplicate', async () => {
    reportExports.list.mockResolvedValueOnce({
      items: [{
        id: 91, reportType: 'erp-invoice', status: 'completed', filters: { branchId: 2 },
        selection: { mode: 'selected', ids: [44] }, filePath: 'reports/91.pdf',
        fileSha256: 'a'.repeat(64), fileSizeBytes: 1200, rowCount: 1,
        attemptCount: 1, cycleAttemptCount: 1, retryCount: 0, failureReason: null,
        queuedAt: '2026-08-09T12:00:00.000Z', startedAt: '2026-08-09T12:00:01.000Z',
        completedAt: '2026-08-09T12:00:02.000Z', failedAt: null, fileDeletedAt: null,
        createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:02.000Z',
      }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(await screen.findByRole('button', { name: 'تنزيل PDF A4' })).toBeDefined();
    expect(reportExports.create).not.toHaveBeenCalled();
  });

  it('recovers the newest usable invoice export from one newest-first history page', async () => {
    reportExports.list.mockResolvedValueOnce({
      items: [{
        id: 91, selection: { mode: 'selected', ids: [44] }, status: 'completed',
        fileDeletedAt: null, createdAt: '2026-08-09T12:00:00.000Z',
      }, {
        id: 92, selection: { mode: 'selected', ids: [44] }, status: 'completed',
        fileDeletedAt: null, createdAt: '2026-08-09T13:00:00.000Z',
      }],
      meta: { page: 1, pageSize: 100, total: 101, totalPages: 2 },
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    expect(await screen.findByRole('button', { name: 'تنزيل PDF A4' })).toBeDefined();
    expect(reportExports.list).toHaveBeenCalledOnce();
    expect(reportExports.list).toHaveBeenCalledWith({
      reportType: 'erp-invoice', page: 1, pageSize: 100,
    });
    expect(reportExports.get).toHaveBeenCalledWith(92);
    expect(reportExports.get).not.toHaveBeenCalledWith(91);
  });

  it('does not offer download when a completed invoice export file was deleted', async () => {
    reportExports.list.mockResolvedValueOnce({
      items: [{
        id: 91, selection: { mode: 'selected', ids: [44] }, status: 'processing',
        fileDeletedAt: null, createdAt: '2026-08-09T12:00:00.000Z',
      }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    reportExports.get.mockResolvedValueOnce({
      id: 91, reportType: 'erp-invoice', status: 'completed', filters: { branchId: 2 },
      selection: { mode: 'selected', ids: [44] }, filePath: null, fileSha256: null,
      fileSizeBytes: null, rowCount: 1, attemptCount: 1, cycleAttemptCount: 1, retryCount: 0,
      failureReason: null, queuedAt: '', startedAt: '', completedAt: '', failedAt: null,
      fileDeletedAt: '2026-08-09T13:00:00.000Z', createdAt: '', updatedAt: '',
    });

    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    await waitFor(() => expect(reportExports.get).toHaveBeenCalledWith(91));
    expect(screen.queryByRole('button', { name: 'تنزيل PDF A4' })).toBeNull();
  });

  it('allows a replacement when every matching completed invoice PDF was deleted', async () => {
    reportExports.list.mockResolvedValueOnce({
      items: [{
        id: 91, selection: { mode: 'selected', ids: [44] }, status: 'completed',
        fileDeletedAt: '2026-08-09T13:00:00.000Z', createdAt: '2026-08-09T12:00:00.000Z',
      }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    const createButton = await screen.findByRole('button', { name: 'إنشاء PDF A4' });
    expect(reportExports.get).not.toHaveBeenCalled();
    fireEvent.click(createButton);
    await waitFor(() => expect(reportExports.create).toHaveBeenCalledOnce());
  });

  it('allows an Admin to retry loading a known invoice export status', async () => {
    reportExports.list.mockResolvedValueOnce({
      items: [{ selection: { mode: 'selected', ids: [44] }, id: 91 }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    reportExports.get.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
      id: 91, reportType: 'erp-invoice', status: 'completed', filters: { branchId: 2 },
      selection: { mode: 'selected', ids: [44] }, filePath: 'reports/91.pdf', fileSha256: 'a',
      fileSizeBytes: 1, rowCount: 1, attemptCount: 1, cycleAttemptCount: 1, retryCount: 0,
      failureReason: null, queuedAt: '', startedAt: '', completedAt: '', failedAt: null,
      fileDeletedAt: null, createdAt: '', updatedAt: '',
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    fireEvent.click(await screen.findByRole('button', { name: 'إعادة تحميل حالة PDF' }));
    await waitFor(() => expect(reportExports.get).toHaveBeenCalledTimes(2));
  });

  it('keeps a pending void panel and its idempotency identity when navigation is attempted', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    let rejectVoid!: (error: Error) => void;
    voidInvoice.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectVoid = reject; }));
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledOnce());
    const originalKey = voidInvoice.mock.calls[0]![1].idempotencyKey;

    fireEvent.click(screen.getByRole('button', { name: 'رجوع' }));

    expect(screen.getByRole('heading', { name: 'إلغاء الفاتورة بالكامل' })).toBeDefined();
    expect((screen.getByLabelText('سبب الإلغاء') as HTMLTextAreaElement).value).toBe('إدخال مكرر');
    rejectVoid(new Error('network timeout'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledTimes(2));
    expect(voidInvoice.mock.calls[1]![1].idempotencyKey).toBe(originalKey);
  });

  it('clears mutation errors when a reversal panel closes', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    voidInvoice.mockRejectedValueOnce(new Error('network timeout'));
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'رجوع' }));

    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('generates a UUID v7 idempotency key when randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint8Array) => values.fill(1),
    });
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));

    await waitFor(() => expect(voidInvoice).toHaveBeenCalledOnce());
    expect(voidInvoice.mock.calls[0]![1].idempotencyKey)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('reports an unavailable browser print API without losing the stored receipt', async () => {
    Object.defineProperty(window, 'print', { configurable: true, value: undefined });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));
    expect(screen.getByRole('alert').textContent).toContain('الطباعة غير متاحة');
    expect(screen.getByText(saleFixtures.completedInvoice.client.name)).toBeDefined();
  });

  it('reports a browser print failure and keeps reprint available', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('printer unavailable'); });
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));
    expect(screen.getByRole('alert').textContent).toContain('تعذر فتح نافذة الطباعة');
    expect(screen.getByRole('button', { name: 'طباعة الإيصال' })).toBeDefined();
  });

  it('shows a safe authorization denial and no receipt facts', async () => {
    getInvoice.mockRejectedValueOnce(Object.assign(new Error('غير مصرح لك بعرض هذه الفاتورة'), {
      status: 403, code: 'ERP_BRANCH_FORBIDDEN', requestId: 'denied-receipt-4',
    }));
    renderView();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('غير مصرح لك بعرض هذه الفاتورة');
    expect(alert.textContent).toContain('denied-receipt-4');
    expect(screen.queryByText(saleFixtures.completedInvoice.invoiceNumber)).toBeNull();
  });

  it('shows a retryable loading failure with its request reference', async () => {
    getInvoice.mockRejectedValueOnce(Object.assign(new Error('تعذر تحميل الفاتورة'), {
      requestId: 'receipt-request-7',
    }));
    renderView();

    expect((await screen.findByRole('alert')).textContent).toContain('receipt-request-7');
    getInvoice.mockResolvedValueOnce(saleFixtures.completedInvoice);
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(screen.getAllByText(saleFixtures.completedInvoice.invoiceNumber).length).toBeGreaterThan(0));
  });

  it('rejects an invalid branch query before requesting receipt data', () => {
    renderView(Number.NaN);
    expect(screen.getByText('رابط الفاتورة غير صالح')).toBeDefined();
    expect(getInvoice).not.toHaveBeenCalled();
  });

  it('prints a scannable invoice barcode beside the QR, so the counter can scan the slip back', async () => {
    renderView();
    await screen.findAllByText(saleFixtures.completedInvoice.invoiceNumber);

    // The QW2100 is a 1D scanner and cannot read the QR code at all.
    const barcode = screen.getByRole('img', { name: saleFixtures.completedInvoice.invoiceNumber });
    expect(barcode.innerHTML).toContain('svg');
  });
});

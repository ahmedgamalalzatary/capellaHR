import { saleFixtures } from '@capella/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getInvoice = vi.hoisted(() => vi.fn());
const quoteRefund = vi.hoisted(() => vi.fn());
const refundInvoice = vi.hoisted(() => vi.fn());
const voidInvoice = vi.hoisted(() => vi.fn());
const originalPrint = window.print;

vi.mock('../src/features/sales/api/sales-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getInvoice,
  quoteRefund,
  refundInvoice,
  voidInvoice,
}));

import { InvoiceReceiptView } from '../src/features/sales/components/invoice-receipt-view';

const renderView = (branchId: number | undefined = 2) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <InvoiceReceiptView invoiceId={44} {...(branchId === undefined ? {} : { branchId })} />
    </QueryClientProvider>,
  );
};

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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'print', { configurable: true, value: originalPrint });
  });

  it('renders every required stored fact and prints without submitting a sale', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderView();

    expect(await screen.findByText(saleFixtures.completedInvoice.invoiceNumber)).toBeDefined();
    expect(screen.getByText(saleFixtures.completedInvoice.client.name)).toBeDefined();
    expect(screen.getByText(saleFixtures.completedInvoice.assignedEmployee.name)).toBeDefined();
    expect(screen.getByText(new RegExp(saleFixtures.completedInvoice.lines[0].name))).toBeDefined();
    expect(screen.getByText(saleFixtures.completedInvoice.authorizedBy.username)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));
    expect(print).toHaveBeenCalledOnce();
    expect(getInvoice).toHaveBeenCalledTimes(1);
    expect(getInvoice).toHaveBeenCalledWith(44, 2);
  });

  it('quotes and confirms a partial refund with exact tender allocation and reason', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    renderView();
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);

    fireEvent.click(screen.getByRole('button', { name: 'استرداد' }));
    fireEvent.change(screen.getByLabelText(`كمية استرداد ${saleFixtures.completedInvoice.lines[0].name}`), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'احسب الاسترداد' }));
    const cashRefund = await screen.findByLabelText('مبلغ الاسترداد نقدي');
    fireEvent.change(cashRefund, { target: { value: '185.00' } });
    fireEvent.change(screen.getByLabelText('سبب الاسترداد'), { target: { value: 'عدم رضا العميل' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الاسترداد' }));

    await waitFor(() => expect(refundInvoice).toHaveBeenCalledWith(44, expect.objectContaining({
      branchId: 2,
      reason: 'عدم رضا العميل',
      lines: [{ invoiceLineId: saleFixtures.completedInvoice.lines[0].id, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
      idempotencyKey: expect.any(String),
    })));
  });

  it('locks refund quantities while an exact quote is pending', async () => {
    let resolveQuote!: (value: Awaited<ReturnType<typeof quoteRefund>>) => void;
    quoteRefund.mockReturnValueOnce(new Promise((resolve) => { resolveQuote = resolve; }));
    renderView();
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'استرداد' }));
    const quantity = screen.getByLabelText(
      `كمية استرداد ${saleFixtures.completedInvoice.lines[0].name}`,
    ) as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'احسب الاسترداد' }));

    await waitFor(() => expect(quantity.disabled).toBe(true));
    resolveQuote({
      lines: [{
        invoiceLineId: saleFixtures.completedInvoice.lines[0].id,
        quantity: 1,
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      }],
      totals: { grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
      payments: [{ method: 'cash', refundableAmount: '185.00' }],
    });
    await waitFor(() => expect(quantity.disabled).toBe(false));
  });

  it('does not quote quantities above the refundable balance', async () => {
    renderView();
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'استرداد' }));
    fireEvent.change(screen.getByLabelText(
      `كمية استرداد ${saleFixtures.completedInvoice.lines[0].name}`,
    ), { target: { value: '2' } });

    const quoteButton = screen.getByRole('button', { name: 'احسب الاسترداد' }) as HTMLButtonElement;
    expect(quoteButton.disabled).toBe(true);
    fireEvent.click(quoteButton);
    expect(quoteRefund).not.toHaveBeenCalled();
  });

  it('shows original remaining tenders and immutable reversal line/payment details', async () => {
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

    expect(await screen.findByText('تم استرداد 185.00 ج.م · متبقي 0.00 ج.م')).toBeDefined();
    expect(screen.getByText('صبغة شعر × 1 · 185.00 ج.م')).toBeDefined();
    expect(screen.getByText('نقدي · 185.00 ج.م')).toBeDefined();
  });

  it('requires a reason and confirms an eligible same-day full void', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    renderView();
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
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
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });

    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));

    await waitFor(() => expect(voidInvoice).toHaveBeenCalledTimes(2));
    expect(voidInvoice.mock.calls[1]![1].idempotencyKey)
      .toBe(voidInvoice.mock.calls[0]![1].idempotencyKey);
  });

  it('keeps a pending refund panel and its idempotency identity when navigation is attempted', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    let rejectRefund!: (error: Error) => void;
    refundInvoice.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRefund = reject; }));
    renderView();
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'استرداد' }));
    fireEvent.change(screen.getByLabelText(
      `كمية استرداد ${saleFixtures.completedInvoice.lines[0].name}`,
    ), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'احسب الاسترداد' }));
    fireEvent.change(await screen.findByLabelText('مبلغ الاسترداد نقدي'), { target: { value: '185.00' } });
    fireEvent.change(screen.getByLabelText('سبب الاسترداد'), { target: { value: 'عدم رضا العميل' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الاسترداد' }));
    await waitFor(() => expect(refundInvoice).toHaveBeenCalledOnce());
    const originalKey = refundInvoice.mock.calls[0]![1].idempotencyKey;

    fireEvent.click(screen.getByRole('button', { name: 'رجوع' }));
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.click(screen.getByRole('button', { name: 'استرداد' }));

    expect(screen.getByRole('heading', { name: 'استرداد جزئي أو كامل' })).toBeDefined();
    expect((screen.getByLabelText('سبب الاسترداد') as HTMLTextAreaElement).value).toBe('عدم رضا العميل');
    rejectRefund(new Error('network timeout'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الاسترداد' }));
    await waitFor(() => expect(refundInvoice).toHaveBeenCalledTimes(2));
    expect(refundInvoice.mock.calls[1]![1].idempotencyKey).toBe(originalKey);
  });

  it('keeps a pending void panel and its idempotency identity when navigation is attempted', async () => {
    getInvoice.mockResolvedValueOnce({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
    let rejectVoid!: (error: Error) => void;
    voidInvoice.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectVoid = reject; }));
    renderView();
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledOnce());
    const originalKey = voidInvoice.mock.calls[0]![1].idempotencyKey;

    fireEvent.click(screen.getByRole('button', { name: 'رجوع' }));
    fireEvent.click(screen.getByRole('button', { name: 'استرداد' }));
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));

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
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'إدخال مكرر' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'رجوع' }));

    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'استرداد' }));
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
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
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
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);

    fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));
    expect(screen.getByRole('alert').textContent).toContain('الطباعة غير متاحة');
    expect(screen.getByText(saleFixtures.completedInvoice.client.name)).toBeDefined();
  });

  it('reports a browser print failure and keeps reprint available', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('printer unavailable'); });
    renderView();
    await screen.findByText(saleFixtures.completedInvoice.invoiceNumber);
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
    await waitFor(() => expect(screen.getByText(saleFixtures.completedInvoice.invoiceNumber)).toBeDefined());
  });

  it('rejects an invalid branch query before requesting receipt data', () => {
    renderView(Number.NaN);
    expect(screen.getByText('رابط الفاتورة غير صالح')).toBeDefined();
    expect(getInvoice).not.toHaveBeenCalled();
  });
});

import { saleFixtures } from '@capella/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getInvoice = vi.hoisted(() => vi.fn());
const originalPrint = window.print;

vi.mock('../src/features/sales/api/sales-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getInvoice,
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
  });

  afterEach(() => {
    cleanup();
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

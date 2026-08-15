import { saleFixtures } from '@capella/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listInvoices = vi.hoisted(() => vi.fn());
const getInvoice = vi.hoisted(() => vi.fn());
const quoteRefund = vi.hoisted(() => vi.fn());
const refundInvoice = vi.hoisted(() => vi.fn());
const voidInvoice = vi.hoisted(() => vi.fn());
const listBranches = vi.hoisted(() => vi.fn());
const actor = vi.hoisted(() => ({ current: 'admin' as 'admin' | 'cashier' }));

vi.mock('../src/features/sales/api/sales-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listInvoices,
  getInvoice,
  quoteRefund,
  refundInvoice,
  voidInvoice,
}));
vi.mock('../src/features/auth', () => ({
  useSession: () => ({
    data: { actor: actor.current === 'admin'
      ? { type: 'admin', accountId: 1 }
      : { type: 'cashier', accountId: 2, employeeId: 3 } },
  }),
}));
vi.mock('../src/features/cashier-sessions', () => ({
  listCashierSessionBranches: listBranches,
}));

import { RefundsView } from '../src/features/sales/components/refunds-view';

const invoiceNumber = saleFixtures.completedInvoice.invoiceNumber;

const historyItem = {
  id: saleFixtures.completedInvoice.id,
  invoiceNumber,
  status: 'completed',
  client: saleFixtures.completedInvoice.client,
  assignedEmployee: saleFixtures.completedInvoice.assignedEmployee,
  total: '185.00',
  soldAt: saleFixtures.completedInvoice.soldAt,
};

/** `null` renders the tab with no preselected branch, as a cashier sees it. */
const renderView = (branchId: number | null = 2) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RefundsView {...(branchId === null ? {} : { initialBranchId: branchId })} />
    </QueryClientProvider>,
  );
  return queryClient;
};

const openInvoice = async () => {
  fireEvent.click(await screen.findByRole('button', { name: `فتح مرتجع ${invoiceNumber}` }));
};

describe('refunds tab', () => {
  beforeEach(() => {
    actor.current = 'admin';
    listBranches.mockReset().mockResolvedValue({
      items: [{ id: 2, name: 'الفرع الرئيسي' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    listInvoices.mockReset().mockResolvedValue({
      items: [historyItem],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    getInvoice.mockReset().mockResolvedValue({
      ...saleFixtures.completedInvoice,
      eligibility: { canVoid: true, canRefund: true },
    });
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
      ...saleFixtures.completedInvoice,
      status: 'refunded',
      eligibility: { canVoid: false, canRefund: false },
    });
    voidInvoice.mockReset().mockResolvedValue({
      ...saleFixtures.completedInvoice,
      status: 'voided',
      eligibility: { canVoid: false, canRefund: false },
    });
  });

  afterEach(cleanup);

  it('loads the chosen invoice into the reversal panel without leaving the tab', async () => {
    renderView();

    await openInvoice();

    expect(await screen.findByRole('button', { name: 'استرداد' })).toBeDefined();
    expect(getInvoice).toHaveBeenCalledWith(44, 2);
  });

  it('quotes and confirms a partial refund with exact tender allocation and reason', async () => {
    const queryClient = renderView();
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      queryClient.setQueryData([key, 'existing'], { cached: true });
    }
    await openInvoice();

    fireEvent.click(await screen.findByRole('button', { name: 'استرداد' }));
    fireEvent.change(screen.getByLabelText(`كمية استرداد ${saleFixtures.completedInvoice.lines[0].name}`), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'احسب الاسترداد' }));
    fireEvent.change(await screen.findByLabelText('مبلغ الاسترداد نقدي'), {
      target: { value: '185.00' },
    });
    fireEvent.change(screen.getByLabelText('سبب الاسترداد'), { target: { value: 'عدم رضا العميل' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الاسترداد' }));

    await waitFor(() => expect(refundInvoice).toHaveBeenCalledWith(44, expect.objectContaining({
      branchId: 2,
      reason: 'عدم رضا العميل',
      lines: [{ invoiceLineId: saleFixtures.completedInvoice.lines[0].id, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
      idempotencyKey: expect.any(String),
    })));
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      expect(queryClient.getQueryState([key, 'existing'])?.isInvalidated).toBe(true);
    }
  });

  it('confirms a full void with a reason from the same panel', async () => {
    renderView();
    await openInvoice();

    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء الفاتورة' }));
    fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'فاتورة خاطئة' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));

    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith(44, expect.objectContaining({
      branchId: 2,
      reason: 'فاتورة خاطئة',
      idempotencyKey: expect.any(String),
    })));
  });

  it('searches stored invoices by number or client before choosing one', async () => {
    renderView();
    await screen.findByRole('button', { name: `فتح مرتجع ${invoiceNumber}` });

    fireEvent.change(screen.getByLabelText('بحث برقم الفاتورة أو العميل'), {
      target: { value: 'منى' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));

    await waitFor(() => expect(listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 2, search: 'منى', page: 1 }),
    ));
  });

  it('explains that a fully reversed invoice has nothing left to refund', async () => {
    getInvoice.mockResolvedValue({
      ...saleFixtures.completedInvoice,
      status: 'refunded',
      lines: saleFixtures.completedInvoice.lines.map((line) => ({
        ...line, refundedQuantity: 1, refundableQuantity: 0,
      })),
      eligibility: { canVoid: false, canRefund: false },
    });
    renderView();

    await openInvoice();

    expect(await screen.findByText('لا يمكن استرداد أو إلغاء هذه الفاتورة.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'استرداد' })).toBeNull();
  });

  it('serves a cashier the same panel without a branch filter', async () => {
    actor.current = 'cashier';
    renderView(null);

    await openInvoice();

    expect(await screen.findByRole('button', { name: 'استرداد' })).toBeDefined();
    expect(getInvoice).toHaveBeenCalledWith(44, undefined);
    expect(listBranches).not.toHaveBeenCalled();
  });
});

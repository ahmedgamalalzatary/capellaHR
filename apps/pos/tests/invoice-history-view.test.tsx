import { saleFixtures } from '@capella/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { current: { type: 'cashier', accountId: 3, employeeId: 9 } as { type: string; accountId?: number; employeeId?: number } },
  listInvoices: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/auth', () => ({ useSession: () => ({ data: { actor: mocks.actor.current } }) }));
vi.mock('../src/features/cashier-sessions', () => ({ listCashierSessionBranches: mocks.listBranches }));
vi.mock('../src/features/sales/api/sales-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listInvoices: mocks.listInvoices,
}));

import { InvoiceHistoryView } from '../src/features/sales/components/invoice-history-view';

const item = {
  id: 44,
  invoiceNumber: saleFixtures.completedInvoice.invoiceNumber,
  status: 'completed',
  total: saleFixtures.completedInvoice.totals.total,
  client: { id: 5, name: saleFixtures.completedInvoice.client.name },
  employees: [
    { id: 8, name: saleFixtures.completedInvoice.lines[0].employee.name },
    { id: 11, name: 'هدى محمود' },
  ],
  soldAt: saleFixtures.completedInvoice.soldAt,
};

const renderView = (initialBranchId?: number) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <InvoiceHistoryView {...(initialBranchId === undefined ? {} : { initialBranchId })} />
  </QueryClientProvider>);
};

describe('invoice history', () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.actor.current = { type: 'cashier', accountId: 3, employeeId: 9 };
    mocks.listInvoices.mockReset().mockResolvedValue({
      items: [item], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    mocks.listBranches.mockReset().mockResolvedValue({
      items: [{ id: 2, name: 'الفرع الرئيسي' }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
  });

  it('announces invoice loading', () => {
    mocks.listInvoices.mockReturnValue(new Promise(() => undefined));
    renderView();

    expect(screen.getByRole('status', { name: 'جارٍ تحميل الفواتير…' })).toBeDefined();
  });

  it('lists branch-scoped stored invoices with receipt links', async () => {
    renderView();
    const link = await screen.findByRole('link', { name: item.invoiceNumber });
    expect(link.getAttribute('href')).toBe('/invoices/44');
    // Every employee behind the sale is named, not just the first.
    expect(screen.getByText(new RegExp(`${item.client.name}.*سارة علي.*هدى محمود`))).toBeDefined();
    expect(screen.getByText('مكتملة')).toBeDefined();
    expect(mocks.listInvoices).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('labels product-only invoices as having no assigned employee', async () => {
    mocks.listInvoices.mockResolvedValueOnce({
      items: [{ ...item, employees: [] }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    renderView();

    expect(await screen.findByText(new RegExp(`${item.client.name}.*بدون موظف`))).toBeDefined();
  });

  it('searches invoices by trimmed invoice or client text', async () => {
    renderView();
    await screen.findByRole('link', { name: item.invoiceNumber });

    const searchInput = screen.getByLabelText('بحث برقم الفاتورة أو العميل');
    expect(searchInput.classList.contains('grow')).toBe(true);
    expect(screen.getByText('بحث برقم الفاتورة أو العميل').classList.contains('grow')).toBe(false);

    fireEvent.change(searchInput, {
      target: { value: '  منى  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));

    await waitFor(() => expect(mocks.listInvoices).toHaveBeenCalledWith({
      page: 1, pageSize: 20, search: 'منى',
    }));
  });

  it('requires an Admin branch and carries it into receipt links', async () => {
    mocks.actor.current = { type: 'admin' };
    renderView();
    const branch = await screen.findByLabelText('الفرع');
    fireEvent.change(branch, { target: { value: '2' } });

    await waitFor(() => expect(mocks.listInvoices).toHaveBeenCalledWith({
      branchId: 2, page: 1, pageSize: 20,
    }));
    expect((await screen.findByRole('link', { name: item.invoiceNumber })).getAttribute('href'))
      .toBe('/invoices/44?branchId=2');
  });

  it('uses the initial Admin branch selection supplied by the route', async () => {
    mocks.actor.current = { type: 'admin' };
    renderView(2);

    const branch = await screen.findByRole('combobox') as HTMLSelectElement;
    await waitFor(() => expect(branch.value).toBe('2'));
    await waitFor(() => expect(mocks.listInvoices).toHaveBeenCalledWith({
      branchId: 2, page: 1, pageSize: 20,
    }));
  });

  it('shows a retryable Admin branch-loading failure', async () => {
    mocks.actor.current = { type: 'admin' };
    mocks.listBranches.mockRejectedValueOnce(new Error('network'));
    renderView();

    expect((await screen.findByRole('alert')).textContent).toContain('تعذر تحميل الفروع');
    mocks.listBranches.mockResolvedValueOnce({
      items: [{ id: 2, name: 'الفرع الرئيسي' }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('option', { name: 'الفرع الرئيسي' })).toBeDefined();
  });
});

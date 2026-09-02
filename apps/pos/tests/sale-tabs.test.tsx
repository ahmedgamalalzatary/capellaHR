import { saleFixtures } from '@capella/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

const mocks = vi.hoisted(() => ({
  actor: { current: { type: 'cashier', accountId: 3 } as
    { type: 'cashier'; accountId: number } | { type: 'admin'; accountId: number } },
  getCurrentSession: vi.fn(),
  getClient: vi.fn(async () => ({ id: 5, branchId: 2, fullName: 'منى أحمد', phone: '01012345678' })),
  listBranches: vi.fn(),
  listBranchCashierRoster: vi.fn(),
  quoteSale: vi.fn(),
  completeSale: vi.fn(),
  listSellableProducts: vi.fn(),
  listAssignableEmployees: vi.fn(),
  clientPickerProps: vi.fn(),
  serviceAvailable: { current: true },
  getBooking: vi.fn(),
}));

vi.mock('../src/features/auth', () => ({
  useSession: () => ({ data: { actor: mocks.actor.current } }),
}));
vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', () => ({
  getCurrentCashierSession: mocks.getCurrentSession,
  listCashierSessionBranches: mocks.listBranches,
}));
vi.mock('../src/features/cashier-accounts/api/branch-roster-api', () => ({
  listBranchCashierRoster: mocks.listBranchCashierRoster,
  replaceBranchCashierRoster: vi.fn(),
}));
vi.mock('../src/features/clients', () => ({
  getClient: mocks.getClient,
  ClientPicker: (props: { branchId?: number; selected?: unknown; onSelect: (value: unknown) => void }) => (
    mocks.clientPickerProps(props),
    <button onClick={() => props.onSelect({ id: 5, branchId: 2, fullName: 'منى أحمد', phone: '01012345678' })}>
      اختر العميل
    </button>
  ),
}));
vi.mock('../src/features/products/api/products-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listSellableProducts: mocks.listSellableProducts,
}));
vi.mock('../src/features/sales/api/sales-api', () => ({
  quoteSale: mocks.quoteSale,
  completeSale: mocks.completeSale,
}));
vi.mock('../src/features/catalog', () => ({
  ServicePicker: (props: {
    onSelect: (value: unknown) => void;
    onAvailabilityChange?: (value: boolean) => void;
  }) => {
    useEffect(() => { props.onAvailabilityChange?.(mocks.serviceAvailable.current); }, [props.onAvailabilityChange]);
    return (
      <>
        <button onClick={() => props.onSelect({
          id: 21, branchId: 2, categoryId: 1, categoryName: 'شعر', categoryIsActive: true,
          name: 'صبغة شعر', description: null, price: '200.00', commissionPercent: '10.00',
          isActive: true, createdAt: '', updatedAt: '',
        })}>
          أضف الخدمة
        </button>
        <button onClick={() => props.onSelect({
          id: 23, branchId: 2, categoryId: 1, categoryName: 'أظافر', categoryIsActive: true,
          name: 'مانيكير', description: null, price: '120.00', commissionPercent: '10.00',
          isActive: true, createdAt: '', updatedAt: '',
        })}>
          أضف خدمة أخرى
        </button>
      </>
    );
  },
}));
vi.mock('../src/features/employee-assignment', () => ({
  PresentEmployeePicker: ({ onSelect }: { onSelect: (value: unknown) => void }) => (
    <button onClick={() => onSelect({ id: 8, employeeCode: 1008, fullName: 'سارة علي', branchId: 2 })}>
      اختر الموظف
    </button>
  ),
  listAssignableEmployees: mocks.listAssignableEmployees,
  employeeAssignmentQueryKeys: {
    present: (branchId?: number) => ['erp-assignable-employees', branchId ?? 'own'],
  },
}));
vi.mock('../src/features/bookings', () => ({
  getBooking: mocks.getBooking,
  bookingQueryKeys: { detail: (id: number) => ['erp-bookings', 'detail', id, 'own'] },
}));

import { SalesView } from '../src/features/sales/components/sales-view';
import {
  listSaleDrafts,
  readActiveSaleDraftId,
  writeSaleDraft,
  type SaleDraft,
  type SaleDraftOwner,
} from '../src/features/sales/sale-draft-storage';

const invoice = saleFixtures.completedInvoice;

const owner: SaleDraftOwner = { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 };

const performer = { id: 8, employeeCode: 1008, fullName: 'سارة علي', branchId: 2 };

const catalogService = (id: number, name: string, price: string) => ({
  id,
  branchId: 2,
  categoryId: 1,
  categoryName: 'شعر',
  categoryIsActive: true,
  name,
  description: null,
  price,
  commissionPercent: '10.00',
  isActive: true,
  createdAt: '',
  updatedAt: '',
});

/** A sale already parked in the browser, as the cashier left it. */
const parkedSale = (id: number, name: string, price: string): SaleDraft => ({
  client: {
    id: 5, branchId: 2, fullName: 'منى أحمد', phone: '01012345678', createdAt: '', updatedAt: '',
  },
  employee: performer,
  seller: { id: 9, employeeCode: 1009, fullName: 'أحمد جمال' },
  lines: [{
    service: catalogService(id, name, price),
    quantity: 1,
    unitPrice: price,
    itemType: 'service',
    employee: performer,
  }],
  discountKind: 'percentage',
  discountValue: '',
  taxKind: 'percentage',
  taxValue: '',
  payments: { cash: '', visa: '', instapay: '', vodafone_cash: '' },
  paymentsTouched: false,
  idempotencyKey: crypto.randomUUID(),
});

const money = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

const renderView = (bookingId?: number) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SalesView {...(bookingId === undefined ? {} : { bookingId })} />
    </QueryClientProvider>,
  );
  return client;
};

const submitButton = () => screen.getByRole('button', {
  name: 'مراجعة وإتمام البيع + طباعة',
}) as HTMLButtonElement;

const awaitReady = () => waitFor(() => expect(submitButton().disabled).toBe(false));

/** Fills the sale on screen: a client, one service, its performer, and the cashier. */
const buildSale = async (secondService = false) => {
  fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
  fireEvent.click(screen.getByRole('button', {
    name: secondService ? 'أضف خدمة أخرى' : 'أضف الخدمة',
  }));
  fireEvent.click(screen.getByRole('button', { name: 'اختر الموظف' }));
  fireEvent.change(await screen.findByLabelText('الكاشير'), { target: { value: '9' } });
  await awaitReady();
};

const parkedKeys = () => listSaleDrafts(owner).map((record) => record.draft.idempotencyKey);

describe('sales parked side by side at one till', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.actor.current = { type: 'cashier', accountId: 3 };
    mocks.getCurrentSession.mockReset().mockResolvedValue({ id: 13, branchId: 2, openedByAccountId: 3 });
    mocks.listBranches.mockReset().mockResolvedValue({
      items: [{ id: 2, name: 'Main' }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    mocks.listBranchCashierRoster.mockReset().mockResolvedValue([
      { id: 9, employeeCode: 1009, fullName: 'أحمد جمال' },
    ]);
    mocks.getClient.mockClear();
    mocks.clientPickerProps.mockReset();
    mocks.serviceAvailable.current = true;
    mocks.quoteSale.mockReset().mockImplementation(async (input: {
      lines: Array<{ itemType: string; serviceId?: number; quantity: number; unitPrice?: string }>;
    }) => {
      const cents = input.lines.reduce(
        (sum, line) => sum + Math.round(Number(line.unitPrice ?? '0') * 100) * line.quantity,
        0,
      );
      return {
        lines: input.lines.map((line) => ({
          itemType: line.itemType,
          sourceId: line.serviceId ?? 0,
          name: 'خدمة',
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? '0.00',
          lineTotal: money(Math.round(Number(line.unitPrice ?? '0') * 100) * line.quantity),
        })),
        discount: null,
        tax: null,
        totals: {
          subtotal: money(cents), discountAmount: '0.00', taxAmount: '0.00', total: money(cents),
        },
      };
    });
    mocks.completeSale.mockReset().mockResolvedValue(invoice);
    mocks.listSellableProducts.mockReset().mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    });
    mocks.listAssignableEmployees.mockReset().mockResolvedValue([performer]);
    mocks.getBooking.mockReset();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('stays out of the way until there is a sale worth parking', async () => {
    renderView();
    const pickClient = await screen.findByRole('button', { name: 'اختر العميل' });
    expect(screen.queryByRole('button', { name: 'بيع آخر' })).toBeNull();

    fireEvent.click(pickClient);

    expect(await screen.findByRole('button', { name: 'بيع آخر' })).toBeDefined();
  });

  it('sends no parked-sale bar to a counter that has parked nothing', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['erp-sales', 'cashier-session', null], {
      id: 13, branchId: 2, openedByAccountId: 3,
    });

    const html = renderToString(
      <QueryClientProvider client={queryClient}><SalesView /></QueryClientProvider>,
    );

    expect(html).not.toContain('بيع آخر');
  });

  it('parks the sale in progress and opens an empty one beside it', async () => {
    renderView();
    await buildSale();
    expect(screen.getByText('صبغة شعر')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'بيع آخر' }));

    // The next client starts from a clean sale...
    await waitFor(() => expect(screen.queryByText('صبغة شعر')).toBeNull());
    // ...while the one who walked away keeps their basket, one click away.
    expect(screen.getByRole('button', { name: /1\. صبغة شعر/ })).toBeDefined();
    expect(parkedKeys()).toHaveLength(1);
  });

  it('brings a parked sale back with its items and its client', async () => {
    renderView();
    await buildSale();
    fireEvent.click(screen.getByRole('button', { name: 'بيع آخر' }));
    await waitFor(() => expect(screen.queryByText('صبغة شعر')).toBeNull());
    mocks.getClient.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /1\. صبغة شعر/ }));

    expect(await screen.findByText('صبغة شعر')).toBeDefined();
    // The parked copy keeps only the client id, so the record is fetched back.
    await waitFor(() => expect(mocks.getClient).toHaveBeenCalledWith(5, undefined));
    await awaitReady();
    // A sale the cashier picked is put back at once, never offered as a question.
    expect(screen.queryByRole('button', { name: 'استعادة' })).toBeNull();
  });

  it('submits the sale on screen under its own request key', async () => {
    renderView();
    await buildSale();
    fireEvent.click(screen.getByRole('button', { name: 'بيع آخر' }));
    await buildSale(true);
    const [firstKey, secondKey] = parkedKeys();
    expect(parkedKeys()).toHaveLength(2);

    fireEvent.click(submitButton());

    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      idempotencyKey: secondKey,
      lines: [{
        itemType: 'service', serviceId: 23, quantity: 1, unitPrice: '120.00', employeeId: 8,
      }],
    }));
    // Only the sale that posted is cleared; the parked one is untouched.
    expect(parkedKeys()).toEqual([firstKey]);
  });

  it('remembers which parked sale was being served', async () => {
    const first = parkedSale(21, 'صبغة شعر', '200.00');
    const second = parkedSale(23, 'مانيكير', '120.00');
    writeSaleDraft(owner, first);
    writeSaleDraft(owner, second);
    renderView();
    const [firstListed] = parkedKeys();

    fireEvent.click(await screen.findByRole('button', { name: /^1\. / }));

    await waitFor(() => expect(readActiveSaleDraftId(owner)).toBe(firstListed));
  });

  it('asks before dropping a parked sale, and drops only that one', async () => {
    writeSaleDraft(owner, parkedSale(21, 'صبغة شعر', '200.00'));
    writeSaleDraft(owner, parkedSale(23, 'مانيكير', '120.00'));
    renderView();
    const [, survivor] = parkedKeys();

    fireEvent.click(await screen.findByRole('button', { name: 'حذف البيع 1' }));

    expect(screen.getByRole('dialog', { name: 'حذف البيع المفتوح' })).toBeDefined();
    expect(parkedKeys()).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'حذف البيع' }));

    await waitFor(() => expect(parkedKeys()).toEqual([survivor]));
  });

  it('refuses to open more sales than one till should juggle', async () => {
    for (let index = 1; index <= 6; index += 1) {
      writeSaleDraft(owner, parkedSale(20 + index, `خدمة ${index}`, '100.00'));
    }
    renderView();

    // Serving one of them leaves no empty slot, so the limit is what stops the next.
    fireEvent.click((await screen.findAllByRole('button', { name: /^\d+\. / }))[0]!);

    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'بيع آخر' }) as HTMLButtonElement).disabled,
    ).toBe(true));
    expect(screen.getByText(/لا يمكن فتح أكثر من 6 مبيعات/)).toBeDefined();
  });

  it('keeps a parked sale whole while its client is still being fetched back', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
    await waitFor(() => expect(parkedKeys()).toHaveLength(1));
    const [parked] = parkedKeys();

    fireEvent.click(await screen.findByRole('button', { name: 'بيع آخر' }));
    await screen.findByRole('button', { name: /^2\. بيع جديد/ });
    // The lookup never lands: a slow counter must not cost the cashier the sale.
    mocks.getClient.mockReturnValueOnce(new Promise(() => undefined));

    fireEvent.click(screen.getByRole('button', { name: /^1\. / }));

    await waitFor(() => expect(mocks.getClient).toHaveBeenCalledWith(5, undefined));
    const stored = listSaleDrafts(owner);
    expect(stored.map((record) => record.draft.idempotencyKey)).toEqual([parked]);
    expect(stored[0]?.draft.client).toEqual({ id: 5, branchId: 2 });
  });

  it('never carries a booking into the sale opened after it', async () => {    mocks.getBooking.mockResolvedValue({
      id: 22,
      branchId: 2,
      client: { id: 5, fullName: 'منى أحمد', phone: '01012345678' },
      scheduledAt: '2026-09-02T07:30:00.000Z',
      status: 'arrived',
      note: null,
      invoiceId: null,
      services: [{
        serviceId: 21,
        serviceName: 'صبغة شعر',
        servicePrice: '200.00',
        preferredEmployee: { id: 8, name: 'سارة علي' },
      }],
      createdAt: '',
      updatedAt: '',
    });
    renderView(22);
    expect(await screen.findByText('صبغة شعر')).toBeDefined();

    fireEvent.click(await screen.findByRole('button', { name: 'بيع آخر' }));

    await waitFor(() => expect(screen.queryByText('صبغة شعر')).toBeNull());
  });
});

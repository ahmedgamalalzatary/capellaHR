import { saleFixtures } from '@capella/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  actor: { current: { type: 'cashier', accountId: 3 } as
    { type: 'cashier'; accountId: number } | { type: 'admin'; accountId: number } },
  getCurrentSession: vi.fn(),
  getClient: vi.fn(async () => ({ id: 5, branchId: 2, fullName: 'منى أحمد', phone: '01012345678' })),
  listBranches: vi.fn(),
  listBranchCashierRoster: vi.fn(),
  quoteSale: vi.fn(),
  completeSale: vi.fn(),
  synchronizeOfflineSales: vi.fn(),
  listSellableProducts: vi.fn(),
  listAssignableEmployees: vi.fn(),
  clientPickerProps: vi.fn(),
  servicePickerProps: vi.fn(),
  serviceAvailable: { current: true },
  getBooking: vi.fn(),
  updateBookingStatus: vi.fn(),
  cancelBookingServices: vi.fn(),
  rescheduleBooking: vi.fn(),
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
vi.mock('../src/features/catalog', () => ({
  ServicePicker: (props: { branchId?: number; onSelect: (value: unknown) => void; onAvailabilityChange?: (value: boolean) => void }) => {
    const { onSelect, onAvailabilityChange } = props;
    useEffect(() => { onAvailabilityChange?.(mocks.serviceAvailable.current); }, [onAvailabilityChange]);
    return (
    mocks.servicePickerProps(props), <>
      <button onClick={() => props.onSelect({
        id: 21, branchId: 2, categoryId: 1, categoryName: 'شعر', categoryIsActive: true,
        name: 'صبغة شعر', description: null, price: '200.00', commissionPercent: '10.00',
        isActive: true, createdAt: '', updatedAt: '',
      })}>
        أضف الخدمة
      </button>
      <button onClick={() => props.onSelect({
        id: 22, branchId: 2, categoryId: 1, categoryName: 'شعر', categoryIsActive: true,
        name: 'بروتين الشعر', description: null, price: null, commissionPercent: '15.00',
        isActive: true, createdAt: '', updatedAt: '',
      })}>
        أضف خدمة بسعر مفتوح
      </button>
    </>);
  },
}));
vi.mock('../src/features/products/api/products-api', async (importOriginal) => ({
  getProductBatches: vi.fn(async () => []),
  ...(await importOriginal<object>()),
  listSellableProducts: mocks.listSellableProducts,
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
vi.mock('../src/features/sales/api/sales-api', () => ({
  quoteSale: mocks.quoteSale,
  completeSale: mocks.completeSale,
}));
vi.mock('../src/features/bookings/api/bookings-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBooking: mocks.getBooking,
  updateBookingStatus: mocks.updateBookingStatus,
  cancelBookingServices: mocks.cancelBookingServices,
  rescheduleBooking: mocks.rescheduleBooking,
}));
vi.mock('../src/features/sales/offline-sale-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/sales/offline-sale-sync')>();
  return {
    ...actual,
    synchronizeOfflineSales: (input: Parameters<typeof actual.synchronizeOfflineSales>[0]) => {
      mocks.synchronizeOfflineSales(input);
      return actual.synchronizeOfflineSales(input);
    },
  };
});

import { SalesView } from '../src/features/sales/components/sales-view';
import {
  enqueueOfflineSale,
  markOfflineSaleFailed,
} from '../src/features/sales/offline-sale-queue';

// The saved-sale screen now prints the real receipt, so the stub must be a whole invoice.
const invoice = saleFixtures.completedInvoice;

const renderView = (bookingId?: number) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SalesView {...(bookingId === undefined ? {} : { bookingId })} /></QueryClientProvider>);
  return client;
};

const readStoredPending = () => {
  const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .find((candidate) => candidate === 'capella:pending-sale'
      || candidate?.startsWith('capella:pending-sale:')
      || candidate?.startsWith('capella:offline-sale:v1:'));
  return key ? localStorage.getItem(key) : null;
};

const readOfflineQueue = () => Array.from(
  { length: localStorage.length },
  (_, index) => localStorage.key(index),
).filter((key): key is string => key?.startsWith('capella:offline-sale:v1:') === true)
  .map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as {
    state?: string;
    input?: { idempotencyKey?: string };
  });

const buildDraft = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
  fireEvent.click(screen.getByRole('button', { name: 'أضف الخدمة' }));
  fireEvent.click(screen.getByRole('button', { name: 'اختر الموظف' }));
  await screen.findByText('تم سداد الإجمالي بالكامل');
};

const arrivedBooking = (overrides: {
  status?: string;
  money?: Partial<Record<'paid' | 'held' | 'pendingValue' | 'maxPayable', string>>;
} = {}) => ({
  id: 22, branchId: 2,
  client: { id: 5, fullName: 'منى أحمد', phone: '01012345678' },
  scheduledAt: '2026-08-25T07:30:00.000Z', status: overrides.status ?? 'arrived', note: null,
  money: {
    paid: '0.00', refunded: '0.00', applied: '0.00', held: '0.00',
    pendingValue: '350.00', maxPayable: '350.00', excess: '0.00',
    ...overrides.money,
  },
  services: [
    {
      serviceId: 21, serviceName: 'صبغة شعر', servicePrice: '200.00',
      preferredEmployee: { id: 8, name: 'سارة علي' },
      status: 'pending', invoiceId: null, invoiceNumber: null, queueStatus: null,
    },
    {
      serviceId: 23, serviceName: 'قص شعر', servicePrice: '150.00',
      preferredEmployee: { id: 11, name: 'هدى محمود' },
      status: 'pending', invoiceId: null, invoiceNumber: null, queueStatus: null,
    },
    {
      serviceId: 24, serviceName: 'مانيكير', servicePrice: '100.00', preferredEmployee: null,
      status: 'sold', invoiceId: 3, invoiceNumber: 'INV-3', queueStatus: 'completed',
    },
  ],
  createdAt: '', updatedAt: '',
});

const completeWhenReady = async () => {
  await waitFor(() => {
    const blockersList = screen.queryByRole('list', { name: 'ما ينقص لإتمام البيع' });
    if (blockersList) throw new Error(`blockers: ${blockersList.textContent ?? ''}`);
  });
  const completeButton = screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' });
  await waitFor(() => expect((completeButton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(completeButton);
  await screen.findByText('تم حفظ الفاتورة');
};

describe('ERP service-sale view', () => {
  beforeEach(() => {
    vi.stubGlobal('print', vi.fn());
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
      { id: 10, employeeCode: 1010, fullName: 'منى سعيد' },
    ]);
    mocks.clientPickerProps.mockReset();
    mocks.servicePickerProps.mockReset();
    mocks.serviceAvailable.current = true;
    mocks.quoteSale.mockReset().mockResolvedValue({
      lines: [{ itemType: 'service', sourceId: 21, name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00' }],
      discount: { kind: 'percentage', value: '10.00', amount: '20.00' },
      tax: { kind: 'fixed', value: '5.00', amount: '5.00' },
      totals: { subtotal: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
    });
    mocks.completeSale.mockReset().mockResolvedValue(invoice);
    mocks.listSellableProducts.mockReset().mockResolvedValue({
      items: [{
        id: 31, branchId: 2, name: 'شامبو', description: null,
        sellingPrice: '50.00', lastPurchaseCost: '30.00', lowStockThreshold: 1,
        isActive: true, quantity: 4, createdAt: '', updatedAt: '',
      }],
      meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    });
    mocks.listAssignableEmployees.mockReset().mockResolvedValue([
      { id: 8, employeeCode: 1008, fullName: 'سارة علي', branchId: 2 },
      { id: 11, employeeCode: 1011, fullName: 'هدى محمود', branchId: 2 },
    ]);
    mocks.synchronizeOfflineSales.mockReset();
    mocks.getBooking.mockReset();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('gives the only available item picker the full width', async () => {
    mocks.serviceAvailable.current = false;
    renderView();
    const product = await screen.findByRole('button', { name: /شامبو/ });
    expect(product.closest('.grid')?.className).toBe('grid gap-4');
  });

  it('labels the item section with Products when Services are empty', async () => {
    mocks.serviceAvailable.current = false;
    renderView();
    expect(await screen.findByText('المنتجات')).toBeDefined();
    expect(screen.queryByText('الخدمات والمنتجات')).toBeNull();
  });
  it('announces Cashier-session loading', () => {
    mocks.getCurrentSession.mockReturnValue(new Promise(() => undefined));
    renderView();
    expect(screen.getByRole('status', { name: 'جارٍ تحميل وردية الكاشير…' })).toBeDefined();
  });

  it('names what is missing while Complete stays disabled', async () => {
    renderView();
    const blockers = await screen.findByRole('list', { name: 'ما ينقص لإتمام البيع' });
    expect(within(blockers).getByText('اختر العميل')).toBeDefined();
    expect(within(blockers).getByText('أضف خدمة أو منتجًا')).toBeDefined();
    expect((screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('prefills an arrived booking and carries it into the sale command', async () => {
    mocks.getBooking.mockResolvedValue(arrivedBooking());
    renderView(22);
    await waitFor(() => expect(mocks.clientPickerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ selected: expect.objectContaining({ id: 5 }) }),
    ));
    expect(await screen.findByText('صبغة شعر')).toBeDefined();
  });

  it('sells only the waiting services the cashier keeps and uses the up-front money first', async () => {
    mocks.getBooking.mockResolvedValue(arrivedBooking({
      money: { paid: '100.00', held: '100.00', pendingValue: '350.00', maxPayable: '250.00' },
    }));
    renderView(22);
    expect(await screen.findByText('صبغة شعر')).toBeDefined();
    // The already-sold service never comes back into the basket.
    expect(screen.queryByText('مانيكير')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'حذف قص شعر' }));
    expect(await screen.findByText('مدفوع من المقدم')).toBeDefined();
    // 185.00 quoted, 100.00 already held: the till collects the other 85.00.
    await screen.findByText('تم سداد الإجمالي بالكامل');
    expect((screen.getByLabelText('المبلغ') as HTMLInputElement).value).toBe('85.00');
    await completeWhenReady();
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      bookingId: 22,
      bookingCredit: '100.00',
      payments: [{ method: 'cash', amount: '85.00' }],
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
    }));
    expect(mocks.completeSale.mock.calls[0]?.[0]).not.toHaveProperty('bookingRefund');
  });

  it('hands back the up-front money the invoice and the leftovers do not need', async () => {
    mocks.getBooking.mockResolvedValue(arrivedBooking({
      money: { paid: '350.00', held: '350.00', pendingValue: '350.00', maxPayable: '0.00' },
    }));
    renderView(22);
    expect(await screen.findByText(/سيتم رد 165.00 ج.م للعميل من الدرج/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('رد نقدي'), { target: { value: '65' } });
    fireEvent.change(screen.getByLabelText('رد فيزا'), { target: { value: '100' } });
    await completeWhenReady();
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      bookingCredit: '185.00',
      payments: [],
      bookingRefund: { payments: [{ method: 'cash', amount: '65.00' }, { method: 'visa', amount: '100.00' }] },
    }));
  });

  it('reopens the refund with the amount the server asks for', async () => {
    mocks.getBooking.mockResolvedValue(arrivedBooking({
      money: { paid: '100.00', held: '100.00', pendingValue: '350.00', maxPayable: '250.00' },
    }));
    // The till worked out no refund of its own, but the server holds more money
    // than the basket shows: it refuses and names the amount owed.
    mocks.completeSale.mockReset()
      .mockRejectedValueOnce(new ApiError(409, {
        code: 'BOOKING_REFUND_REQUIRED',
        message: 'يجب إرجاع فائض مقدم الحجز في نفس عملية البيع',
        amount: '35.00',
      }))
      .mockResolvedValue(invoice);
    renderView(22);
    expect(await screen.findByText('صبغة شعر')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'حذف قص شعر' }));
    await screen.findByText('تم سداد الإجمالي بالكامل');
    const completeButton = screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' });
    await waitFor(() => expect((completeButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(completeButton);

    // The refused sale reopens carrying the server's own amount, ready to send back.
    expect(await screen.findByText(/سيتم رد 35.00 ج.م للعميل من الدرج/)).toBeDefined();
    expect((screen.getByLabelText('رد نقدي') as HTMLInputElement).value).toBe('35.00');
    // The spent request is gone: the reopened sale submits under a new key.
    expect(readOfflineQueue()).toEqual([]);
    await completeWhenReady();
    expect(mocks.completeSale.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      bookingId: 22,
      bookingRefund: { payments: [{ method: 'cash', amount: '35.00' }] },
    }));
  });

  it('leaves a refused booking sale recoverable after the refund is paid back', async () => {
    mocks.getBooking.mockResolvedValue(arrivedBooking({
      money: { paid: '100.00', held: '100.00', pendingValue: '350.00', maxPayable: '250.00' },
    }));
    mocks.completeSale.mockReset()
      .mockRejectedValueOnce(new ApiError(409, {
        code: 'BOOKING_REFUND_REQUIRED',
        message: 'يجب إرجاع فائض مقدم الحجز في نفس عملية البيع',
        amount: '35.00',
      }))
      .mockResolvedValue(invoice);
    renderView(22);
    expect(await screen.findByText('صبغة شعر')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'حذف قص شعر' }));
    await screen.findByText('تم سداد الإجمالي بالكامل');
    const completeButton = screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' });
    await waitFor(() => expect((completeButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(completeButton);
    await screen.findByText(/سيتم رد 35.00 ج.م للعميل من الدرج/);
    await completeWhenReady();
    // The saved sale leaves nothing behind for the next cashier to trip over.
    expect(readOfflineQueue()).toEqual([]);
    expect(readStoredPending()).toBeNull();
  });

  it('refuses a booking sale while the till is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mocks.getBooking.mockResolvedValue(arrivedBooking());
    renderView(22);
    const blockers = await screen.findByRole('list', { name: 'ما ينقص لإتمام البيع' });
    await waitFor(() => expect(within(blockers).getByText('بيع الحجز يحتاج اتصالًا بالإنترنت')).toBeDefined());
  });

  it('makes the cashier decide what happens to the services left after the sale', async () => {
    mocks.getBooking.mockResolvedValue(arrivedBooking());
    mocks.updateBookingStatus.mockReset().mockResolvedValue(arrivedBooking({ status: 'booked' }));
    renderView(22);
    expect(await screen.findByText('صبغة شعر')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'حذف قص شعر' }));
    await completeWhenReady();
    const dialog = await screen.findByRole('dialog', { name: 'خدمات الحجز المتبقية' });
    expect(within(dialog).getByText(/قص شعر/)).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'تغيير الموعد' })).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'إلغاء الخدمات المتبقية' })).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'إبقاء في الموعد الأصلي' }));
    await waitFor(() => expect(mocks.updateBookingStatus).toHaveBeenCalledWith(22, { status: 'booked' }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lets each unit of the same service name a different employee and submits one line per unit', async () => {
    // Two units of the same 200.00 service, fully paid in cash.
    mocks.quoteSale.mockResolvedValue({
      lines: [
        { itemType: 'service', sourceId: 21, name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00' },
        { itemType: 'service', sourceId: 21, name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00' },
      ],
      discount: null,
      tax: null,
      totals: { subtotal: '400.00', discountAmount: '0.00', taxAmount: '0.00', total: '400.00' },
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
    // Buy the service once, then use its normal quantity control for the second unit.
    fireEvent.click(screen.getByRole('button', { name: 'أضف الخدمة' }));
    fireEvent.click(screen.getByRole('button', { name: 'زيادة صبغة شعر' }));

    const selects = await screen.findAllByRole('combobox', { name: 'موظف صبغة شعر' });
    expect(selects).toHaveLength(2);
    // The per-line select only honours a value once the assignable-employees read
    // has populated it; wait for the option to exist before choosing.
    await waitFor(() => {
      for (const select of selects) {
        expect(within(select as HTMLElement).queryByRole('option', { name: 'سارة علي' })).not.toBeNull();
        expect(within(select as HTMLElement).queryByRole('option', { name: 'هدى محمود' })).not.toBeNull();
      }
    });
    fireEvent.change(selects[0]!, { target: { value: '8' } });
    fireEvent.change(selects[1]!, { target: { value: '11' } });

    await screen.findByText('تم سداد الإجمالي بالكامل');
    // Reveal any lingering blocker before expecting the button to arm.
    await waitFor(() => {
      const blockersList = screen.queryByRole('list', { name: 'ما ينقص لإتمام البيع' });
      if (blockersList) throw new Error(`blockers: ${blockersList.textContent ?? ''}`);
    });
    const completeButton = screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' });
    await waitFor(() => expect((completeButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(completeButton);

    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      lines: [
        { itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 },
        { itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 11 },
      ],
    }));
  });

  it('completes one fully paid service invoice from the server quote', async () => {
    const queryClient = renderView();
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      queryClient.setQueryData([key, 'existing'], { cached: true });
    }
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));

    await screen.findByText('تم حفظ الفاتورة');
    // The number shows on the saved-sale card; the print copy repeats it on the receipt.
    const savedCard = document.querySelector<HTMLElement>('[data-print-controls]')!;
    expect(within(savedCard).getByText(invoice.invoiceNumber)).toBeDefined();
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      clientId: 5,
      cashierSessionId: 13,
      lines: [{
        itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8,
      }],
      payments: [{ method: 'cash', amount: '185.00' }],
      idempotencyKey: expect.any(String),
    }));
    expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .some((key) => key?.startsWith('capella:sale-draft:') && !key.endsWith(':active'))).toBe(false);
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      expect(queryClient.getQueryState([key, 'existing'])?.isInvalidated).toBe(true);
    }
  });

  it('prints the receipt automatically once the sale is saved, without asking', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'تأكيد البيع' })).toBeNull();
    // The printed receipt is the same document the invoice page prints.
    expect(document.querySelector('[data-receipt]')?.textContent).toContain(invoice.invoiceNumber);
    expect(screen.queryByRole('dialog', { name: 'طباعة الإيصال' })).toBeNull();
    expect(screen.getByText('تم حفظ الفاتورة')).toBeDefined();
  });

  it('prints one copy per saved sale even as the saved-sale card re-renders', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    // Re-printing stays a deliberate click; a re-render must not send a second copy.
    fireEvent.click(screen.getByRole('button', { name: 'طباعة الإيصال' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
  });

  it('keeps the saved sale visible when the browser cannot print', async () => {
    vi.stubGlobal('print', undefined);
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));

    expect((await screen.findByRole('alert')).textContent).toContain('الطباعة غير متاحة في هذا المتصفح');
    expect(screen.getByText('تم حفظ الفاتورة')).toBeDefined();
  });

  it('prints one customer invoice without employee invoices', async () => {
    vi.stubGlobal('print', vi.fn());
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));
    await screen.findByText('تم حفظ الفاتورة');

    expect(document.querySelector('[data-receipt-sheet]')).not.toBeNull();
    expect(document.querySelector('[data-customer-receipt]')).not.toBeNull();
    expect(document.querySelectorAll('[data-employee-receipt]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-customer-receipt]')).toHaveLength(1);
  });

  it('requires and submits an assigned employee on a product-only invoice', async () => {
    mocks.quoteSale.mockResolvedValue({
      lines: [{
        itemType: 'product', sourceId: 31, name: 'شامبو', quantity: 1,
        unitPrice: '50.00', lineTotal: '50.00',
      }],
      discount: null,
      tax: null,
      totals: {
        subtotal: '50.00', discountAmount: '0.00', taxAmount: '0.00', total: '50.00',
      },
    });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
    fireEvent.click(await screen.findByRole('button', { name: /شامبو/ }));
    await screen.findByText('تم سداد الإجمالي بالكامل');

    fireEvent.click(screen.getByRole('button', { name: 'اختر الموظف' }));
    const review = screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' });
    await waitFor(() => expect(review).toHaveProperty('disabled', false));
    fireEvent.click(review);

    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      clientId: 5,
      cashierSessionId: 13,
      lines: [{ itemType: 'product', productId: 31, quantity: 1, employeeId: 8 }],
      payments: [{ method: 'cash', amount: '50.00' }],
    }));
    expect(mocks.completeSale.mock.calls[0]?.[0].lines[0]).toHaveProperty('employeeId', 8);
  });

  it('submits a product-only sale with a balance left open', async () => {
    mocks.quoteSale.mockResolvedValue({
      lines: [{
        itemType: 'product', sourceId: 31, name: 'شامبو', quantity: 1,
        unitPrice: '50.00', lineTotal: '50.00',
      }],
      discount: null, tax: null,
      totals: { subtotal: '50.00', discountAmount: '0.00', taxAmount: '0.00', total: '50.00' },
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
    fireEvent.click(await screen.findByRole('button', { name: /شامبو/ }));
    fireEvent.click(screen.getByRole('button', { name: 'اختر الموظف' }));
    fireEvent.change(await screen.findByLabelText('المبلغ'), { target: { value: '20.00' } });
    const review = screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' });
    await waitFor(() => expect(review).toHaveProperty('disabled', false));
    fireEvent.click(review);
    expect(screen.queryByRole('dialog', { name: 'تأكيد البيع' })).toBeNull();
    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledWith(
      expect.objectContaining({ payments: [{ method: 'cash', amount: '20.00' }] }),
    ));
  });

  it('requires and submits a positive unit price for an open-price service', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
    fireEvent.click(screen.getByRole('button', { name: 'أضف خدمة بسعر مفتوح' }));
    fireEvent.click(screen.getByRole('button', { name: 'اختر الموظف' }));

    expect(mocks.quoteSale).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }))
      .toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('سعر بروتين الشعر'), { target: { value: '800' } });

    await waitFor(() => expect(mocks.quoteSale).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ itemType: 'service', serviceId: 22, quantity: 1, unitPrice: '800' }],
    })));
  });

  it('preserves the same idempotency request after an ambiguous network failure', async () => {
    mocks.completeSale.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(invoice);
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));
    await screen.findByText('تعذر تأكيد نتيجة البيع');
    const stored = JSON.parse(readStoredPending() ?? '{}') as {
      input?: { idempotencyKey?: string };
    };

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة بنفس الطلب' }));
    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      idempotencyKey: stored.input?.idempotencyKey,
    }));
  });

  it('keeps an authoritative conflict and reopens its facts as a fresh editable draft', async () => {
    mocks.completeSale.mockRejectedValueOnce(new ApiError(409, {
      code: 'EMPLOYEE_NOT_ASSIGNABLE',
      message: 'الموظف لم يعد حاضرًا في الفرع',
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));

    expect((await screen.findAllByRole('alert')).some(
      (alert) => alert.textContent?.includes('الموظف لم يعد حاضرًا في الفرع'),
    )).toBe(true);
    expect(screen.queryByText('تعذر تأكيد نتيجة البيع')).toBeNull();
    expect(readOfflineQueue()).toEqual([
      expect.objectContaining({ state: 'conflict' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وتعديل البيع' }));
    expect(await screen.findByText(/تم استعادة البيع للمراجعة/)).toBeDefined();
    expect(screen.getByText('صبغة شعر')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'اختر العميل' }));
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'مراجعة وإتمام البيع + طباعة',
    }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('refetches the client by id when a conflicted sale is reopened for review', async () => {
    mocks.completeSale.mockRejectedValueOnce(new ApiError(409, {
      code: 'EMPLOYEE_NOT_ASSIGNABLE',
      message: 'الموظف لم يعد حاضرًا في الفرع',
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));
    fireEvent.click(await screen.findByRole('button', { name: 'مراجعة وتعديل البيع' }));
    await screen.findByText(/تم استعادة البيع للمراجعة/);

    // The recovery draft holds only the client id, so the record is fetched back
    // and the cashier never has to pick the same client again.
    await waitFor(() => expect(mocks.clientPickerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ selected: expect.objectContaining({ id: 5 }) }),
    ));
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'مراجعة وإتمام البيع + طباعة',
    }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('requires explicit confirmation before discarding a conflicted queued sale', async () => {
    mocks.completeSale.mockRejectedValueOnce(new ApiError(409, {
      code: 'INSUFFICIENT_STOCK',
      message: 'تغير المخزون',
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));
    await screen.findByRole('button', { name: 'حذف البيع المعلق' });

    fireEvent.click(screen.getByRole('button', { name: 'حذف البيع المعلق' }));
    expect(screen.getByRole('dialog', { name: 'تأكيد حذف البيع المعلق' })).toBeDefined();
    expect(readOfflineQueue()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'حذف نهائي' }));
    await waitFor(() => expect(readOfflineQueue()).toEqual([]));
  });

  it('keeps a queued sale visible when browser storage refuses its deletion', async () => {
    mocks.completeSale.mockRejectedValueOnce(new ApiError(409, {
      code: 'INSUFFICIENT_STOCK',
      message: 'تغير المخزون',
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));
    await screen.findByRole('button', { name: 'حذف البيع المعلق' });
    fireEvent.click(screen.getByRole('button', { name: 'حذف البيع المعلق' }));
    const remove = vi.spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });

    fireEvent.click(screen.getByRole('button', { name: 'حذف نهائي' }));

    expect(await screen.findByText(/تعذر حذف البيع المعلق من المتصفح/)).toBeDefined();
    expect(readOfflineQueue()).toHaveLength(1);
    remove.mockRestore();
  });

  it('queues a confirmed draft without an HTTP attempt while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));

    expect(await screen.findByText('بانتظار الاتصال')).toBeDefined();
    expect(mocks.completeSale).not.toHaveBeenCalled();
    expect(readOfflineQueue()).toEqual([
      expect.objectContaining({ state: 'pending' }),
    ]);
  });

  it('preserves the idempotent request when a server failure leaves the outcome ambiguous', async () => {
    mocks.completeSale.mockRejectedValueOnce(new ApiError(500, {
      code: 'UNEXPECTED_ERROR',
      message: 'حدث خطأ غير متوقع',
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));

    expect(await screen.findByText('تعذر تأكيد نتيجة البيع')).toBeDefined();
    expect(readStoredPending()).not.toBeNull();
    expect((screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }) as HTMLButtonElement).disabled)
      .toBe(true);
    const frozenInputs = screen.getByRole('group', { name: 'تفاصيل البيع' });
    expect(frozenInputs.hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('المبلغ').matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'اختر العميل' }).matches(':disabled')).toBe(true);
  });

  it('keeps each unresolved tab submission under its own durable storage key', async () => {
    let resolveCompletion!: (value: typeof invoice) => void;
    mocks.completeSale.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCompletion = resolve;
    }));
    renderView();
    await buildDraft();
    const otherIdempotencyKey = crypto.randomUUID();
    localStorage.setItem(`capella:pending-sale:${otherIdempotencyKey}`, JSON.stringify({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input: {
        clientId: 6,
        cashierSessionId: 13,
        idempotencyKey: otherIdempotencyKey,
        lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));
    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(1));

    const pendingKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key?.startsWith('capella:offline-sale:v1:') === true);
    expect(pendingKeys).toHaveLength(2);
    expect(pendingKeys).toContain(`capella:offline-sale:v1:${otherIdempotencyKey}`);
    expect(localStorage.getItem('capella:pending-sale')).toBeNull();

    resolveCompletion(invoice);
    await screen.findByText('تم حفظ الفاتورة');
  });

  it('replays another tab queued sale in the background while preserving this tab draft', async () => {
    const queryClient = renderView();
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      queryClient.setQueryData([key, 'background'], { cached: true });
    }
    await buildDraft();
    const activeDraftKey = Array.from(
      { length: sessionStorage.length },
      (_, index) => sessionStorage.key(index),
    ).find((key) => key?.startsWith('capella:sale-draft:') && !key.endsWith(':active'));
    const otherIdempotencyKey = crypto.randomUUID();
    const pendingStorageKey = `capella:pending-sale:${otherIdempotencyKey}`;
    const pendingValue = JSON.stringify({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input: {
        clientId: 6,
        cashierSessionId: 13,
        idempotencyKey: otherIdempotencyKey,
        lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
    });
    localStorage.setItem(pendingStorageKey, pendingValue);

    window.dispatchEvent(new StorageEvent('storage', {
      key: pendingStorageKey,
      newValue: pendingValue,
      storageArea: localStorage,
    }));

    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('تم حفظ الفاتورة')).toBeNull();
    expect(screen.queryByText('تعذر تأكيد نتيجة البيع')).toBeNull();
    expect(screen.getByRole('button', { name: 'اختر العميل' }).matches(':disabled')).toBe(false);
    expect(activeDraftKey).toBeDefined();
    expect(sessionStorage.getItem(activeDraftKey!)).not.toBeNull();
    expect(readOfflineQueue()).toEqual([]);
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      expect(queryClient.getQueryState([key, 'background'])?.isInvalidated).toBe(true);
    }
  });

  it('shows and retries a failed predecessor before completing the active queued draft', async () => {
    const predecessor = {
      clientId: 5,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
      payments: [{ method: 'cash' as const, amount: '185.00' }],
    };
    const owner = { accountId: 3, role: 'cashier' as const, branchId: 2, cashierSessionId: 13 };
    enqueueOfflineSale({ owner, input: predecessor });
    markOfflineSaleFailed(predecessor.idempotencyKey, new ApiError(503, {
      code: 'UNEXPECTED_ERROR', message: 'الخادم غير متاح',
    }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }));
    expect(mocks.completeSale).not.toHaveBeenCalled();
    mocks.completeSale
      .mockRejectedValueOnce(new ApiError(503, {
        code: 'UNEXPECTED_ERROR', message: 'الخادم غير متاح',
      }))
      .mockResolvedValue(invoice);
    vi.useFakeTimers();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));

    expect(mocks.completeSale).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.completeSale).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await screen.findByText('الخادم غير متاح')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة بنفس الطلب' }));

    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale).toHaveBeenCalledTimes(3);
    expect(mocks.completeSale.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      predecessor.idempotencyKey,
      predecessor.idempotencyKey,
      expect.not.stringMatching(predecessor.idempotencyKey),
    ]);
    expect(readOfflineQueue()).toEqual([]);
  });

  it('keeps a delayed failed-sale retry when draft state reruns synchronization', async () => {
    const predecessor = {
      clientId: 5,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
      payments: [{ method: 'cash' as const, amount: '185.00' }],
    };
    const owner = { accountId: 3, role: 'cashier' as const, branchId: 2, cashierSessionId: 13 };
    enqueueOfflineSale({ owner, input: predecessor });
    markOfflineSaleFailed(predecessor.idempotencyKey, new ApiError(503, {
      code: 'UNEXPECTED_ERROR', message: 'الخادم غير متاح',
    }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderView();
    const selectClient = await screen.findByRole('button', { name: 'اختر العميل' });
    await screen.findByText('الخادم غير متاح');
    vi.useFakeTimers();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    fireEvent.click(selectClient);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.completeSale).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: predecessor.idempotencyKey,
    }));
  });

});

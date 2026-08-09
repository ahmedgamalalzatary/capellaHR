import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  actor: { current: { type: 'cashier', accountId: 3, employeeId: 9 } as
    { type: 'cashier'; accountId: number; employeeId: number } | { type: 'admin'; accountId: number } },
  getCurrentSession: vi.fn(),
  listBranches: vi.fn(),
  quoteSale: vi.fn(),
  completeSale: vi.fn(),
  synchronizeOfflineSales: vi.fn(),
  clientPickerProps: vi.fn(),
  servicePickerProps: vi.fn(),
}));

vi.mock('../src/features/auth', () => ({
  useSession: () => ({ data: { actor: mocks.actor.current } }),
}));
vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', () => ({
  getCurrentCashierSession: mocks.getCurrentSession,
  listCashierSessionBranches: mocks.listBranches,
}));
vi.mock('../src/features/clients', () => ({
  ClientPicker: (props: { branchId?: number; selected?: unknown; onSelect: (value: unknown) => void }) => (
    mocks.clientPickerProps(props),
    <button onClick={() => props.onSelect({ id: 5, branchId: 2, fullName: 'منى أحمد', phone: '01012345678' })}>
      اختر العميل
    </button>
  ),
}));
vi.mock('../src/features/catalog', () => ({
  ServicePicker: (props: { branchId?: number; onSelect: (value: unknown) => void }) => (
    mocks.servicePickerProps(props),
    <button onClick={() => props.onSelect({
      id: 21, branchId: 2, categoryId: 1, categoryName: 'شعر', categoryIsActive: true,
      name: 'صبغة شعر', description: null, price: '200.00', commissionPercent: '10.00',
      isActive: true, createdAt: '', updatedAt: '',
    })}>
      أضف الخدمة
    </button>
  ),
}));
vi.mock('../src/features/employee-assignment', () => ({
  PresentEmployeePicker: ({ onSelect }: { onSelect: (value: unknown) => void }) => (
    <button onClick={() => onSelect({ id: 8, employeeCode: 1008, fullName: 'سارة علي', branchId: 2 })}>
      اختر الموظف
    </button>
  ),
}));
vi.mock('../src/features/sales/api/sales-api', () => ({
  quoteSale: mocks.quoteSale,
  completeSale: mocks.completeSale,
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

const invoice = {
  id: 44,
  invoiceNumber: 'INV-2026.08.03-14.35-17',
  totals: { total: '185.00' },
};

const renderView = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SalesView /></QueryClientProvider>);
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
  await screen.findByText('185.00 ج.م');
};

describe('ERP service-sale view', () => {
  it('announces Cashier-session loading', () => {
    mocks.getCurrentSession.mockReturnValue(new Promise(() => undefined));
    renderView();
    expect(screen.getByRole('status', { name: 'جارٍ تحميل وردية الكاشير…' })).toBeDefined();
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.actor.current = { type: 'cashier', accountId: 3, employeeId: 9 };
    mocks.getCurrentSession.mockReset().mockResolvedValue({ id: 13, branchId: 2, openedByAccountId: 3 });
    mocks.listBranches.mockReset().mockResolvedValue({
      items: [{ id: 2, name: 'Main' }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    mocks.clientPickerProps.mockReset();
    mocks.servicePickerProps.mockReset();
    mocks.quoteSale.mockReset().mockResolvedValue({
      lines: [{ itemType: 'service', sourceId: 21, name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00' }],
      discount: { kind: 'percentage', value: '10.00', amount: '20.00' },
      tax: { kind: 'fixed', value: '5.00', amount: '5.00' },
      totals: { subtotal: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
    });
    mocks.completeSale.mockReset().mockResolvedValue(invoice);
    mocks.synchronizeOfflineSales.mockReset();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('completes one fully paid service invoice from the server quote', async () => {
    const queryClient = renderView();
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      queryClient.setQueryData([key, 'existing'], { cached: true });
    }
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

    await screen.findByText('تم حفظ الفاتورة');
    expect(screen.getByText(invoice.invoiceNumber)).toBeDefined();
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
      idempotencyKey: expect.any(String),
    }));
    expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .some((key) => key?.startsWith('capella:sale-draft:') && !key.endsWith(':active'))).toBe(false);
    for (const key of ['erp-sales', 'clients', 'erp-products', 'erp-commissions', 'erp-reports']) {
      expect(queryClient.getQueryState([key, 'existing'])?.isInvalidated).toBe(true);
    }
  });

  it('preserves the same idempotency request after an ambiguous network failure', async () => {
    mocks.completeSale.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(invoice);
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

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
      name: 'مراجعة وإتمام البيع',
    }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('requires explicit confirmation before discarding a conflicted queued sale', async () => {
    mocks.completeSale.mockRejectedValueOnce(new ApiError(409, {
      code: 'INSUFFICIENT_STOCK',
      message: 'تغير المخزون',
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

    expect(await screen.findByText('تعذر تأكيد نتيجة البيع')).toBeDefined();
    expect(readStoredPending()).not.toBeNull();
    expect((screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }) as HTMLButtonElement).disabled)
      .toBe(true);
    const frozenInputs = screen.getByRole('group', { name: 'تفاصيل البيع' });
    expect(frozenInputs.hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('نقدي').matches(':disabled')).toBe(true);
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
        assignedEmployeeId: 8,
        cashierSessionId: 13,
        idempotencyKey: otherIdempotencyKey,
        lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));
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
        assignedEmployeeId: 8,
        cashierSessionId: 13,
        idempotencyKey: otherIdempotencyKey,
        lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
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
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1 }],
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
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));
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
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1 }],
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

  it('replays a failed sale once across an online-offline-online connectivity flap', async () => {
    const predecessor = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 12,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash' as const, amount: '185.00' }],
    };
    enqueueOfflineSale({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 12 },
      input: predecessor,
    });
    markOfflineSaleFailed(predecessor.idempotencyKey, new ApiError(503, {
      code: 'UNEXPECTED_ERROR', message: 'الخادم غير متاح',
    }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderView();
    await screen.findByRole('button', { name: 'اختر العميل' });
    await waitFor(() => expect(mocks.clientPickerProps.mock.calls.length).toBeGreaterThan(1));
    vi.useFakeTimers();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.synchronizeOfflineSales).toHaveBeenCalledTimes(1);
    expect(mocks.synchronizeOfflineSales).toHaveBeenCalledWith(expect.objectContaining({
      owner: expect.objectContaining({ cashierSessionId: 12 }),
      includeFailed: true,
    }));
    await vi.waitFor(() => expect(mocks.completeSale).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: predecessor.idempotencyKey }),
    ));
  });

  it('updates the pending queue label from connectivity events', async () => {
    const input = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash' as const, amount: '185.00' }],
    };
    enqueueOfflineSale({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input,
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mocks.completeSale.mockImplementation(() => new Promise(() => undefined));
    renderView();
    await screen.findByText('بانتظار الاتصال');

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));

    expect(screen.getByText('بانتظار المزامنة')).toBeDefined();
  });

  it('does not submit when durable browser storage is unavailable and explains recovery', async () => {
    renderView();
    await buildDraft();
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });

    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

    expect(await screen.findByText(/تعذر حفظ طلب البيع بأمان/)).toBeDefined();
    expect(mocks.completeSale).not.toHaveBeenCalled();
    storageWrite.mockRestore();
  });

  it('blocks completion until client, service, employee, and exact payment are ready', async () => {
    renderView();
    const submit = await screen.findByRole('button', { name: 'مراجعة وإتمام البيع' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await buildDraft();
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  });

  it('restores an in-progress workspace draft after the route remounts', async () => {
    renderView();
    await buildDraft();
    await waitFor(() => expect(Array.from(
      { length: sessionStorage.length },
      (_, index) => sessionStorage.key(index),
    ).some((key) => key?.startsWith('capella:sale-draft:') && !key.endsWith(':active'))).toBe(true));

    cleanup();
    renderView();

    expect(await screen.findByText('صبغة شعر')).toBeDefined();
    await waitFor(() => expect(mocks.clientPickerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ selected: null }),
    ));
    expect((screen.getByRole('button', {
      name: 'مراجعة وإتمام البيع',
    }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'اختر العميل' }));
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'مراجعة وإتمام البيع',
    }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/تم استعادة مسودة البيع/)).toBeDefined();
  });

  it('keeps the server render hydration-safe when a browser draft exists', async () => {
    renderView();
    await buildDraft();
    await waitFor(() => expect(Array.from(
      { length: sessionStorage.length },
      (_, index) => sessionStorage.key(index),
    ).some((key) => key?.startsWith('capella:sale-draft:') && !key.endsWith(':active'))).toBe(true));
    cleanup();

    const queryClient = new QueryClient();
    queryClient.setQueryData(['erp-sales', 'cashier-session', null], {
      id: 13,
      branchId: 2,
      openedByAccountId: 3,
    });
    const html = renderToString(
      <QueryClientProvider client={queryClient}><SalesView /></QueryClientProvider>,
    );

    expect(html).not.toContain('صبغة شعر');
    expect(html).not.toContain('تم استعادة مسودة البيع');
  });

  it('replays a durable pending request after the app reloads online', async () => {
    const pending = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
    };
    localStorage.setItem('capella:pending-sale', JSON.stringify({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input: pending,
    }));
    renderView();
    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(pending);
  });

  it('replays every queued request for the current workspace in creation order', async () => {
    const first = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
    };
    const second = { ...first, idempotencyKey: '22222222-2222-4222-8222-222222222222' };
    const owner = { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 };
    localStorage.setItem(`capella:pending-sale:${first.idempotencyKey}`, JSON.stringify({ owner, input: first }));
    localStorage.setItem(`capella:pending-sale:${second.idempotencyKey}`, JSON.stringify({ owner, input: second }));

    renderView();

    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(2));
    expect(mocks.completeSale.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      first.idempotencyKey,
      second.idempotencyKey,
    ]);
    expect(readOfflineQueue()).toEqual([]);
  });

  it('recovers the matching workspace request when another owner record sorts first', async () => {
    const matching = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
    };
    localStorage.setItem('capella:pending-sale:00000000-0000-4000-8000-000000000000', JSON.stringify({
      owner: { accountId: 4, role: 'cashier', branchId: 2, cashierSessionId: 12 },
      input: { ...matching, cashierSessionId: 12, idempotencyKey: '00000000-0000-4000-8000-000000000000' },
    }));
    localStorage.setItem(`capella:pending-sale:${matching.idempotencyKey}`, JSON.stringify({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input: matching,
    }));

    renderView();

    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(matching);
  });

  it('recovers a committed pending sale after its Cashier session has closed', async () => {
    const pending = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
    };
    localStorage.setItem('capella:pending-sale', JSON.stringify({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input: pending,
    }));
    mocks.getCurrentSession.mockResolvedValue(null);

    renderView();

    await screen.findByText('تم حفظ الفاتورة');
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(pending);
  });

  it('replays every queued sale for the cashier even after the session has closed', async () => {
    const first = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
    };
    const second = { ...first, idempotencyKey: '44444444-4444-4444-8444-444444444444' };
    const owner = { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 };
    localStorage.setItem(`capella:pending-sale:${first.idempotencyKey}`, JSON.stringify({ owner, input: first }));
    localStorage.setItem(`capella:pending-sale:${second.idempotencyKey}`, JSON.stringify({ owner, input: second }));
    mocks.getCurrentSession.mockResolvedValue(null);

    renderView();

    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(2));
    expect(readOfflineQueue()).toEqual([]);
  });

  it('retries a closed-session queued sale when connectivity returns', async () => {
    const pending = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
    };
    localStorage.setItem('capella:pending-sale', JSON.stringify({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input: pending,
    }));
    mocks.getCurrentSession.mockResolvedValue(null);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderView();
    await screen.findByText(/استعادة نتيجة البيع المعلق/);
    expect(mocks.completeSale).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(1));
    expect(readOfflineQueue()).toEqual([]);
  });

  it('replays an older-session queue in the background after a new session opens', async () => {
    const pending = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 12,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185.00' }],
    };
    localStorage.setItem('capella:pending-sale', JSON.stringify({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 12 },
      input: pending,
    }));

    renderView();

    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(1));
    expect(mocks.completeSale.mock.calls[0]?.[0]).toEqual(pending);
    expect(await screen.findByRole('heading', { name: 'بيع جديد' })).toBeDefined();
    expect(screen.getByText(/تمت مزامنة بيع معلق بنجاح/)).toBeDefined();
    expect(readOfflineQueue()).toEqual([]);

    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));
    await screen.findByText('تم حفظ الفاتورة');
    fireEvent.click(screen.getByRole('button', { name: 'بيع جديد' }));

    expect(screen.queryByText(/تمت مزامنة بيع معلق بنجاح/)).toBeNull();
  });

  it('reopens an older-session conflict under the current session with a fresh key', async () => {
    const oldInput = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 12,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1 }],
      payments: [{ method: 'cash' as const, amount: '185.00' }],
    };
    enqueueOfflineSale({
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 12 },
      input: oldInput,
      recoveryDraft: {
        client: { id: 5, branchId: 2, fullName: 'منى أحمد', phone: '01012345678', createdAt: '', updatedAt: '' },
        employee: { id: 8, employeeCode: 1008, fullName: 'سارة علي', branchId: 2 },
        lines: [{
          service: {
            id: 21, branchId: 2, categoryId: 1, categoryName: 'شعر', categoryIsActive: true,
            name: 'صبغة شعر', description: null, price: '200.00', commissionPercent: '10.00',
            isActive: true, createdAt: '', updatedAt: '',
          },
          quantity: 1,
          itemType: 'service',
        }],
        discountKind: 'percentage',
        discountValue: '',
        taxKind: 'percentage',
        taxValue: '',
        payments: { cash: '185.00', visa: '', instapay: '', vodafone_cash: '' },
        paymentsTouched: false,
        idempotencyKey: oldInput.idempotencyKey,
      },
    });
    markOfflineSaleFailed(oldInput.idempotencyKey, new ApiError(409, {
      code: 'PRICE_CHANGED',
      message: 'تغير السعر',
    }));

    renderView();
    await buildDraft();
    expect(screen.queryByRole('button', { name: 'مراجعة وتعديل البيع' })).toBeNull();
    expect(screen.getByText('صبغة شعر')).toBeDefined();
    cleanup();
    sessionStorage.clear();
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'مراجعة وتعديل البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'اختر العميل' }));
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'مراجعة وإتمام البيع',
    }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

    await screen.findByText('تم حفظ الفاتورة');
    const submitted = mocks.completeSale.mock.calls[0]?.[0] as {
      cashierSessionId: number;
      idempotencyKey: string;
    };
    expect(submitted.cashierSessionId).toBe(13);
    expect(submitted.idempotencyKey).not.toBe(oldInput.idempotencyKey);
    expect(readOfflineQueue()).toEqual([]);
  });

  it('does not replay, clear, or block on a pending sale owned by another cashier session', async () => {
    const stored = {
      owner: { accountId: 4, role: 'cashier', branchId: 2, cashierSessionId: 12 },
      input: {
        clientId: 5,
        assignedEmployeeId: 8,
        cashierSessionId: 12,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
    };
    localStorage.setItem('capella:pending-sale', JSON.stringify(stored));

    renderView();

    expect(await screen.findByRole('heading', { name: 'بيع جديد' })).toBeDefined();
    expect(screen.queryByText(/بيع معلق.*حساب أو وردية أخرى/)).toBeNull();
    expect(mocks.completeSale).not.toHaveBeenCalled();
    await waitFor(() => expect(localStorage.getItem('capella:pending-sale')).toBeNull());
    expect(readOfflineQueue()).toEqual([
      expect.objectContaining({ input: expect.objectContaining(stored.input) }),
    ]);
    await buildDraft();
    expect((screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('replays a newer queued request saved by another tab after the active request', async () => {
    let resolveCompletion!: (value: typeof invoice) => void;
    mocks.completeSale.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCompletion = resolve;
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));
    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(1));
    const replacement = {
      owner: { accountId: 3, role: 'cashier', branchId: 2, cashierSessionId: 13 },
      input: {
        ...(mocks.completeSale.mock.calls[0]?.[0] as object),
        idempotencyKey: crypto.randomUUID(),
      },
    };
    localStorage.setItem('capella:pending-sale', JSON.stringify(replacement));

    resolveCompletion(invoice);
    await screen.findByText('تم حفظ الفاتورة');

    await waitFor(() => expect(mocks.completeSale).toHaveBeenCalledTimes(2));
    expect(mocks.completeSale.mock.calls[1]?.[0]).toEqual(expect.objectContaining(replacement.input));
    expect(readOfflineQueue()).toEqual([]);
  });

  it('passes the Admin selected branch to client and service pickers', async () => {
    mocks.actor.current = { type: 'admin', accountId: 1 };
    renderView();

    await screen.findByRole('option', { name: 'Main' });
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: '2' } });

    await waitFor(() => expect(mocks.clientPickerProps).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2 })));
    expect(mocks.servicePickerProps).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2 }));
  });

  it('shows and retries an Admin branch-loading error', async () => {
    mocks.actor.current = { type: 'admin', accountId: 1 };
    mocks.listBranches.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      items: [{ id: 2, name: 'Main' }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    renderView();

    expect(await screen.findByText('تعذر تحميل الفروع')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

    expect(await screen.findByRole('option', { name: 'Main' })).toBeDefined();
  });

  it('retries a failed Cashier-session load without reloading the page', async () => {
    mocks.getCurrentSession.mockRejectedValueOnce(new Error('offline'));
    renderView();

    expect(await screen.findByText('تعذر تحميل وردية الكاشير')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

    expect(await screen.findByRole('heading', { name: 'بيع جديد' })).toBeDefined();
    expect(mocks.getCurrentSession).toHaveBeenCalledTimes(2);
  });

  it('retries a failed quote without changing the sale draft', async () => {
    mocks.quoteSale.mockRejectedValueOnce(new Error('offline'));
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
    fireEvent.click(screen.getByRole('button', { name: 'أضف الخدمة' }));
    fireEvent.click(screen.getByRole('button', { name: 'اختر الموظف' }));

    expect(await screen.findByText('حدث خطأ غير متوقع. حاول مرة أخرى.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة حساب الإجمالي' }));

    expect(await screen.findByText('185.00 ج.م')).toBeDefined();
    expect(mocks.quoteSale).toHaveBeenCalledTimes(2);
  });

  it('shows feedback when an Admin has no branches', async () => {
    mocks.actor.current = { type: 'admin', accountId: 1 };
    mocks.listBranches.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    });
    renderView();

    expect(await screen.findByText('لا توجد فروع متاحة')).toBeDefined();
  });

  it('closes the sale confirmation dialog with Escape', async () => {
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    expect(screen.getByRole('dialog', { name: 'تأكيد البيع' })).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'تأكيد البيع' })).toBeNull();
  });
});

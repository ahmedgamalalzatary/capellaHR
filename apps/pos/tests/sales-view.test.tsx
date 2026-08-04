import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  actor: { current: { type: 'cashier', accountId: 3, employeeId: 9 } as
    { type: 'cashier'; accountId: number; employeeId: number } | { type: 'admin'; accountId: number } },
  getCurrentSession: vi.fn(),
  listBranches: vi.fn(),
  quoteSale: vi.fn(),
  completeSale: vi.fn(),
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
  ClientPicker: (props: { branchId?: number; onSelect: (value: unknown) => void }) => (
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

import { SalesView } from '../src/features/sales/components/sales-view';

const invoice = {
  id: 44,
  invoiceNumber: 'INV-2026.08.03-14.35-17',
  totals: { total: '185.00' },
};

const renderView = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SalesView /></QueryClientProvider>);
};

const readStoredPending = () => {
  const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .find((candidate) => candidate === 'capella:pending-sale'
      || candidate?.startsWith('capella:pending-sale:'));
  return key ? localStorage.getItem(key) : null;
};

const buildDraft = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'اختر العميل' }));
  fireEvent.click(screen.getByRole('button', { name: 'أضف الخدمة' }));
  fireEvent.click(screen.getByRole('button', { name: 'اختر الموظف' }));
  await screen.findByText('185.00 ج.م');
};

describe('ERP service-sale view', () => {
  beforeEach(() => {
    localStorage.clear();
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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('completes one fully paid service invoice from the server quote', async () => {
    renderView();
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

  it('shows an authoritative server rejection without offering ambiguous retry', async () => {
    mocks.completeSale.mockRejectedValueOnce(new ApiError(409, {
      code: 'EMPLOYEE_NOT_ASSIGNABLE',
      message: 'الموظف لم يعد حاضرًا في الفرع',
    }));
    renderView();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

    expect((await screen.findByRole('alert')).textContent).toContain('الموظف لم يعد حاضرًا في الفرع');
    expect(screen.queryByText('تعذر تأكيد نتيجة البيع')).toBeNull();
    expect(localStorage.getItem('capella:pending-sale')).toBeNull();
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
      .filter((key): key is string => key?.startsWith('capella:pending-sale:') === true);
    expect(pendingKeys).toHaveLength(2);
    expect(pendingKeys).toContain(`capella:pending-sale:${otherIdempotencyKey}`);
    expect(localStorage.getItem('capella:pending-sale')).toBeNull();

    resolveCompletion(invoice);
    await screen.findByText('تم حفظ الفاتورة');
  });

  it('does not submit when durable browser storage is unavailable and explains recovery', async () => {
    renderView();
    await buildDraft();
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });

    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد البيع' }));

    expect((await screen.findByRole('alert')).textContent).toContain('تعذر حفظ طلب البيع بأمان');
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

    expect(await screen.findByRole('heading', { name: 'بيع خدمة' })).toBeDefined();
    expect(screen.queryByText(/بيع معلق.*حساب أو وردية أخرى/)).toBeNull();
    expect(mocks.completeSale).not.toHaveBeenCalled();
    expect(localStorage.getItem('capella:pending-sale')).toBeNull();
    expect(JSON.parse(localStorage.getItem(
      `capella:pending-sale:${stored.input.idempotencyKey}`,
    ) ?? '{}')).toEqual(stored);
    await buildDraft();
    expect((screen.getByRole('button', { name: 'مراجعة وإتمام البيع' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('does not clear a newer pending request saved by another tab', async () => {
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

    expect(JSON.parse(localStorage.getItem('capella:pending-sale') ?? '{}')).toEqual(replacement);
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

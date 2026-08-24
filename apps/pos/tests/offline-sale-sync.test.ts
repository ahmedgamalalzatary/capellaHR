import type { CompleteSaleInput, PublicInvoiceDto } from '@capella/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';
import {
  enqueueOfflineSale,
  listOfflineSales,
  type OfflineSaleOwner,
} from '../src/features/sales/offline-sale-queue';
import {
  offlineSaleSyncLeaseStorageKey,
  synchronizeOfflineSales,
} from '../src/features/sales/offline-sale-sync';

const owner: OfflineSaleOwner = {
  accountId: 3,
  role: 'cashier',
  branchId: 2,
  cashierSessionId: 13,
};

const sale = (idempotencyKey = crypto.randomUUID()): CompleteSaleInput => ({
  clientId: 5,
  sellerEmployeeId: 9,
  cashierSessionId: 13,
  idempotencyKey,
  lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
  payments: [{ method: 'cash', amount: '185.00' }],
});

const invoice = (input: CompleteSaleInput): PublicInvoiceDto => ({
  id: 44,
  invoiceNumber: `INV-${input.idempotencyKey}`,
  status: 'completed',
  kind: 'sale',
  branchId: 2,
  cashierSessionId: 13,
  client: { id: 5, name: 'عميل', phone: '01000000000' },
  seller: { id: 9, employeeCode: 1009, name: 'أحمد جمال' },
  authorizedBy: { accountId: 3, username: 'cashier' },
  lines: [],
  discount: null,
  tax: null,
  totals: {
    subtotal: '185.00', discountAmount: '0.00', taxAmount: '0.00',
    total: '185.00', paymentTotal: '185.00',
    amountPaid: '185.00', creditedAmount: '0.00', balanceDue: '0.00',
    settlementStatus: 'settled',
  },
  payments: [{
    method: 'cash', amount: '185.00', refundedAmount: '0.00', refundableAmount: '185.00',
  }],
  reversals: [],
  eligibility: { canVoid: true, canRefund: true },
  soldAt: '2026-08-08T12:00:00.000Z',
});

describe('offline sale synchronization', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('replays queued payloads in order and removes each only after confirmation', async () => {
    const first = sale();
    const second = sale();
    enqueueOfflineSale({ owner, input: first });
    enqueueOfflineSale({ owner, input: second });
    const submit = vi.fn(async (input: CompleteSaleInput) => invoice(input));

    const result = await synchronizeOfflineSales({ owner, submit });

    expect(submit.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      first.idempotencyKey,
      second.idempotencyKey,
    ]);
    expect(result.confirmed).toEqual([
      { idempotencyKey: first.idempotencyKey, invoice: invoice(first) },
      { idempotencyKey: second.idempotencyKey, invoice: invoice(second) },
    ]);
    expect(listOfflineSales(owner)).toEqual([]);
  });

  it('reports a confirmed invoice even when queue removal fails', async () => {
    const input = sale();
    enqueueOfflineSale({ owner, input });
    const originalRemoveItem = Storage.prototype.removeItem;
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key.includes(input.idempotencyKey)) throw new Error('storage unavailable');
      originalRemoveItem.call(this, key);
    });

    const result = await synchronizeOfflineSales({
      owner,
      submit: async (submitted) => invoice(submitted),
    });
    removeItem.mockRestore();

    expect(result.confirmed).toEqual([{ idempotencyKey: input.idempotencyKey, invoice: invoice(input) }]);
    expect(listOfflineSales(owner)).toEqual([expect.objectContaining({ input })]);
  });

  it('can exclude failed items while automatically replaying pending items', async () => {
    const failed = sale();
    const pending = sale();
    enqueueOfflineSale({ owner, input: failed });
    enqueueOfflineSale({ owner, input: pending });
    await synchronizeOfflineSales({
      owner,
      submit: vi.fn().mockRejectedValue(new ApiError(503, { code: 'UNAVAILABLE', message: 'failed' })),
    });
    const submit = vi.fn(async (input: CompleteSaleInput) => invoice(input));

    await synchronizeOfflineSales({ owner, submit, includeFailed: false });

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith(pending);
    expect(listOfflineSales(owner)).toEqual([expect.objectContaining({ input: failed, state: 'failed' })]);
  });

  it('keeps a connectivity failure and stops replaying later items until reconnect', async () => {
    const first = sale();
    const second = sale();
    enqueueOfflineSale({ owner, input: first });
    enqueueOfflineSale({ owner, input: second });
    const submit = vi.fn().mockRejectedValue(new ApiError(0, {
      code: 'NETWORK_ERROR', message: 'لا يوجد اتصال',
    }));

    const result = await synchronizeOfflineSales({ owner, submit });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ confirmed: [], failed: [first.idempotencyKey] });
    expect(listOfflineSales(owner)).toEqual([
      expect.objectContaining({ state: 'failed', input: first }),
      expect.objectContaining({ state: 'pending', input: second }),
    ]);
  });

  it('retains a timed-out request and later confirms the same idempotency key', async () => {
    const input = sale();
    enqueueOfflineSale({ owner, input });
    const timeout = vi.fn().mockRejectedValue(new ApiError(408, {
      code: 'REQUEST_TIMEOUT', message: 'timeout',
    }));

    await expect(synchronizeOfflineSales({ owner, submit: timeout })).resolves.toMatchObject({
      failed: [input.idempotencyKey],
    });
    expect(listOfflineSales(owner)[0]).toMatchObject({ state: 'failed', input });

    const confirmed = vi.fn(async (sameInput: CompleteSaleInput) => invoice(sameInput));
    await expect(synchronizeOfflineSales({ owner, submit: confirmed })).resolves.toMatchObject({
      confirmed: [{ idempotencyKey: input.idempotencyKey }],
    });
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: input.idempotencyKey,
    }));
    expect(listOfflineSales(owner)).toEqual([]);
  });

  it('retains the request when an interrupted response cannot be parsed', async () => {
    const input = sale();
    enqueueOfflineSale({ owner, input });

    await synchronizeOfflineSales({
      owner,
      submit: vi.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
    });

    expect(listOfflineSales(owner)[0]).toMatchObject({
      state: 'failed',
      input,
      failure: { kind: 'retryable', code: 'NETWORK_ERROR' },
    });
  });

  it('keeps a permanent conflict for editing and continues with later valid sales', async () => {
    const first = sale();
    const second = sale();
    enqueueOfflineSale({ owner, input: first });
    enqueueOfflineSale({ owner, input: second });
    const submit = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, {
        code: 'INSUFFICIENT_STOCK', message: 'تغير المخزون',
      }))
      .mockImplementationOnce(async (input: CompleteSaleInput) => invoice(input));

    const result = await synchronizeOfflineSales({ owner, submit });

    expect(result.conflicts).toEqual([first.idempotencyKey]);
    expect(result.confirmed).toHaveLength(1);
    expect(listOfflineSales(owner)).toEqual([
      expect.objectContaining({ state: 'conflict', input: first }),
    ]);
  });

  it('does nothing while the browser reports that it is offline', async () => {
    enqueueOfflineSale({ owner, input: sale() });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const submit = vi.fn();

    await expect(synchronizeOfflineSales({ owner, submit })).resolves.toEqual({
      confirmed: [], failed: [], conflicts: [],
    });
    expect(submit).not.toHaveBeenCalled();
    expect(listOfflineSales(owner)[0]).toMatchObject({ state: 'pending' });
  });

  it('does not replay a queue item already being synchronized by another caller', async () => {
    const input = sale();
    enqueueOfflineSale({ owner, input });
    let release!: () => void;
    const submit = vi.fn(() => new Promise<PublicInvoiceDto>((resolve) => {
      release = () => resolve(invoice(input));
    }));

    const first = synchronizeOfflineSales({ owner, submit });
    const second = synchronizeOfflineSales({ owner, submit });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    release();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(listOfflineSales(owner)).toEqual([]);
  });

  it('does not replay while another browser tab holds the fallback synchronization lease', async () => {
    const input = sale();
    enqueueOfflineSale({ owner, input });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    localStorage.setItem(offlineSaleSyncLeaseStorageKey(owner), JSON.stringify({
      token: crypto.randomUUID(),
      expiresAt: Date.now() + 60_000,
    }));
    const submit = vi.fn();

    await expect(synchronizeOfflineSales({ owner, submit })).resolves.toEqual({
      confirmed: [], failed: [], conflicts: [],
    });

    expect(submit).not.toHaveBeenCalled();
    expect(listOfflineSales(owner)).toEqual([expect.objectContaining({ input })]);
  });

  it('stops waiting for a Web Lock after the acquisition timeout', async () => {
    vi.useFakeTimers();
    try {
      const input = sale();
      enqueueOfflineSale({ owner, input });
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: vi.fn((_name: string, options: LockOptions) => new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => reject(
              new DOMException('The operation was aborted', 'AbortError'),
            ));
          })),
        },
      });
      const synchronization = synchronizeOfflineSales({ owner, submit: vi.fn() });

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(synchronization).resolves.toEqual({ confirmed: [], failed: [], conflicts: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reclaim a fallback lease that another tab acquired after suspension', async () => {
    vi.useFakeTimers();
    try {
      const input = sale();
      enqueueOfflineSale({ owner, input });
      Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
      let finish!: () => void;
      const submit = vi.fn(() => new Promise<PublicInvoiceDto>((resolve) => {
        finish = () => resolve(invoice(input));
      }));

      const synchronization = synchronizeOfflineSales({ owner, submit });
      await vi.advanceTimersByTimeAsync(20);
      expect(submit).toHaveBeenCalledTimes(1);
      const leaseKey = offlineSaleSyncLeaseStorageKey(owner);
      const newerLease = { token: crypto.randomUUID(), expiresAt: Date.now() + 30_000 };
      localStorage.setItem(leaseKey, JSON.stringify(newerLease));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(JSON.parse(localStorage.getItem(leaseKey) ?? '{}')).toEqual(newerLease);
      finish();
      await synchronization;
    } finally {
      vi.useRealTimers();
    }
  });
});

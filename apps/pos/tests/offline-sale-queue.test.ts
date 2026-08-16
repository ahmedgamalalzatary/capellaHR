import type { CompleteSaleInput } from '@capella/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../src/lib/api/client';
import type { SaleDraft } from '../src/features/sales/sale-draft-storage';
import {
  classifySaleSubmissionError,
  enqueueOfflineSale,
  getOfflineSaleQueueVersion,
  hasUnrecoverableOfflineSales,
  listOfflineSales,
  markOfflineSaleFailed,
  markOfflineSaleSyncing,
  migrateLegacyPendingSales,
  offlineSaleQueueStorageKey,
  offlineSaleRetryDelayMs,
  recoverInterruptedOfflineSales,
  removeOfflineSale,
  subscribeOfflineSaleQueue,
  type OfflineSaleOwner,
} from '../src/features/sales/offline-sale-queue';

const owner: OfflineSaleOwner = {
  accountId: 3,
  role: 'cashier',
  branchId: 2,
  cashierSessionId: 13,
};

const sale = (idempotencyKey = crypto.randomUUID()): CompleteSaleInput => ({
  clientId: 5,
  sellerEmployeeId: 9,
  assignedEmployeeId: 8,
  cashierSessionId: 13,
  idempotencyKey,
  lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00' }],
  payments: [{ method: 'cash', amount: '185.00' }],
});

const recoveryDraft = (idempotencyKey: string): SaleDraft => ({
  client: {
    id: 5, branchId: 2, fullName: 'منى أحمد', phone: '01012345678',
    createdAt: '', updatedAt: '',
  },
  employee: { id: 8, employeeCode: 1008, fullName: 'سارة علي', branchId: 2 },
  seller: { id: 9, employeeCode: 1009, fullName: 'أحمد جمال' },
  lines: [{
    service: {
      id: 21, branchId: 2, categoryId: 1, categoryName: 'شعر', categoryIsActive: true,
      name: 'صبغة شعر', description: null, price: '185.00', commissionPercent: '10.00',
      isActive: true, createdAt: '', updatedAt: '',
    },
      quantity: 1,
      unitPrice: '200.00',
      itemType: 'service',
  }],
  discountKind: 'percentage',
  discountValue: '',
  taxKind: 'percentage',
  taxValue: '',
  payments: { cash: '185.00', visa: '', instapay: '', vodafone_cash: '' },
  paymentsTouched: false,
  idempotencyKey,
});

describe('offline sale queue', () => {
  beforeEach(() => localStorage.clear());

  it('durably stores multiple scoped sale payloads before submission', () => {
    const first = sale();
    const second = sale();

    expect(enqueueOfflineSale({ owner, input: first })).toMatchObject({
      state: 'pending',
      attempts: 0,
      input: first,
    });
    expect(enqueueOfflineSale({ owner, input: second })).toMatchObject({ input: second });

    expect(listOfflineSales(owner).map((item) => item.input.idempotencyKey)).toEqual([
      first.idempotencyKey,
      second.idempotencyKey,
    ]);
    expect(localStorage.getItem(offlineSaleQueueStorageKey(first.idempotencyKey))).not.toBeNull();
  });

  it('keeps owners isolated and removes only the API-confirmed item', () => {
    const first = sale();
    const second = sale();
    enqueueOfflineSale({ owner, input: first });
    enqueueOfflineSale({ owner: { ...owner, cashierSessionId: 14 }, input: second });

    expect(listOfflineSales(owner)).toHaveLength(1);
    expect(removeOfflineSale(first.idempotencyKey)).toBe(true);
    expect(listOfflineSales()).toEqual([
      expect.objectContaining({ input: second }),
    ]);
  });

  it('ignores a record stored under a key that does not match its payload idempotency key', () => {
    const input = sale();
    const expectedKey = offlineSaleQueueStorageKey(input.idempotencyKey);
    enqueueOfflineSale({ owner, input });
    const raw = localStorage.getItem(expectedKey);
    localStorage.removeItem(expectedKey);
    localStorage.setItem(offlineSaleQueueStorageKey(crypto.randomUUID()), raw!);

    expect(listOfflineSales(owner)).toEqual([]);
  });

  it('reports that removal failed when the requested queue item does not exist', () => {
    expect(removeOfflineSale(crypto.randomUUID())).toBe(false);
  });

  it('recovers an interrupted syncing record as pending after a restart', () => {
    const input = sale();
    enqueueOfflineSale({ owner, input });
    expect(markOfflineSaleSyncing(input.idempotencyKey)).toMatchObject({
      state: 'syncing',
      attempts: 1,
    });

    recoverInterruptedOfflineSales();
    expect(listOfflineSales(owner)).toEqual([
      expect.objectContaining({ state: 'pending', attempts: 1 }),
    ]);
  });

  it('recovers only the requested owner without disturbing another active synchronization', () => {
    const current = sale();
    const otherOwner = { ...owner, accountId: 4, cashierSessionId: 14 };
    const other = { ...sale(), cashierSessionId: 14 };
    enqueueOfflineSale({ owner, input: current });
    enqueueOfflineSale({ owner: otherOwner, input: other });
    markOfflineSaleSyncing(current.idempotencyKey);
    markOfflineSaleSyncing(other.idempotencyKey);

    recoverInterruptedOfflineSales(owner);

    expect(listOfflineSales(owner)[0]).toMatchObject({ state: 'pending' });
    expect(listOfflineSales(otherOwner)[0]).toMatchObject({ state: 'syncing' });
  });

  it('retains retryable and permanent failures with actionable details', () => {
    const retryable = sale();
    const conflict = sale();
    enqueueOfflineSale({ owner, input: retryable });
    enqueueOfflineSale({ owner, input: conflict });

    expect(markOfflineSaleFailed(retryable.idempotencyKey, new ApiError(503, {
      code: 'UNEXPECTED_ERROR', message: 'الخادم غير متاح',
    }))).toMatchObject({
      state: 'failed',
      failure: { kind: 'retryable', code: 'UNEXPECTED_ERROR', message: 'الخادم غير متاح' },
    });
    expect(markOfflineSaleFailed(conflict.idempotencyKey, new ApiError(409, {
      code: 'INSUFFICIENT_STOCK', message: 'المخزون تغير',
    }))).toMatchObject({
      state: 'conflict',
      failure: { kind: 'conflict', code: 'INSUFFICIENT_STOCK', message: 'المخزون تغير' },
    });
    expect(listOfflineSales(owner)).toHaveLength(2);
  });

  it('classifies connectivity, timeout, authentication, server, and validation failures', () => {
    expect(classifySaleSubmissionError(new ApiError(0, {
      code: 'NETWORK_ERROR', message: 'offline',
    }))).toBe('retryable');
    expect(classifySaleSubmissionError(new ApiError(401, {
      code: 'UNAUTHENTICATED', message: 'login',
    }))).toBe('retryable');
    expect(classifySaleSubmissionError(new ApiError(408, {
      code: 'REQUEST_TIMEOUT', message: 'timeout',
    }))).toBe('retryable');
    expect(classifySaleSubmissionError(new ApiError(429, {
      code: 'RATE_LIMITED', message: 'later',
    }))).toBe('retryable');
    expect(classifySaleSubmissionError(new ApiError(500, {
      code: 'UNEXPECTED_ERROR', message: 'server',
    }))).toBe('retryable');
    expect(classifySaleSubmissionError(new ApiError(409, {
      code: 'INSUFFICIENT_STOCK', message: 'changed',
    }))).toBe('conflict');
    expect(classifySaleSubmissionError(new Error('network'))).toBe('retryable');
  });

  it('migrates every legacy pending request without changing its idempotency key', () => {
    const first = sale();
    const second = sale();
    localStorage.setItem('capella:pending-sale', JSON.stringify({ owner, input: first }));
    localStorage.setItem(`capella:pending-sale:${second.idempotencyKey}`, JSON.stringify({
      owner,
      input: second,
    }));

    migrateLegacyPendingSales();

    expect(listOfflineSales(owner).map((item) => item.input.idempotencyKey)).toEqual([
      first.idempotencyKey,
      second.idempotencyKey,
    ]);
    expect(localStorage.getItem('capella:pending-sale')).toBeNull();
    expect(localStorage.getItem(`capella:pending-sale:${second.idempotencyKey}`)).toBeNull();
  });

  it('durably stores a product-only sale without an employee assignment', () => {
    const input: CompleteSaleInput = {
      clientId: 5,
      sellerEmployeeId: 9,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'product', productId: 31, quantity: 1 }],
      payments: [{ method: 'cash', amount: '50.00' }],
    };

    expect(enqueueOfflineSale({ owner, input })).toMatchObject({ input });
    expect(listOfflineSales(owner)[0]?.input).not.toHaveProperty('assignedEmployeeId');
  });

  it('keeps a pending product-only sale written by the previous employee-required client', () => {
    const idempotencyKey = crypto.randomUUID();
    localStorage.setItem(offlineSaleQueueStorageKey(idempotencyKey), JSON.stringify({
      version: 1,
      owner,
      input: {
        clientId: 5,
        sellerEmployeeId: 9,
        assignedEmployeeId: 8,
        cashierSessionId: 13,
        idempotencyKey,
        lines: [{ itemType: 'product', productId: 31, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      state: 'pending',
      attempts: 0,
      createdAt: 1,
      updatedAt: 1,
      failure: null,
    }));

    expect(listOfflineSales(owner)).toEqual([
      expect.objectContaining({
        input: expect.not.objectContaining({ assignedEmployeeId: expect.anything() }),
      }),
    ]);
    expect(hasUnrecoverableOfflineSales()).toBe(false);
  });

  it('upgrades a pre-price queue item from its fixed-price recovery draft', () => {
    const input = sale();
    localStorage.setItem(offlineSaleQueueStorageKey(input.idempotencyKey), JSON.stringify({
      version: 1,
      owner,
      input: {
        ...input,
        lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
      },
      state: 'pending',
      attempts: 0,
      createdAt: 1,
      updatedAt: 1,
      failure: null,
      recoveryDraft: recoveryDraft(input.idempotencyKey),
    }));

    expect(listOfflineSales(owner)[0]?.input.lines).toEqual([
      { itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00' },
    ]);
    expect(hasUnrecoverableOfflineSales()).toBe(false);
  });

  it('retains and exposes a pre-price legacy request whose price cannot be recovered', () => {
    const input = sale();
    const key = 'capella:pending-sale';
    localStorage.setItem(key, JSON.stringify({
      owner,
      input: { ...input, lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }] },
    }));

    migrateLegacyPendingSales();

    expect(localStorage.getItem(key)).not.toBeNull();
    expect(hasUnrecoverableOfflineSales()).toBe(true);
  });

  it('fails closed when durable storage is unavailable', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    try {
      expect(enqueueOfflineSale({ owner, input: sale() })).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('keeps editable recovery facts without persisting client PII', () => {
    const input = sale();

    enqueueOfflineSale({ owner, input, recoveryDraft: recoveryDraft(input.idempotencyKey) });

    expect(listOfflineSales(owner)[0]?.recoveryDraft).toMatchObject({
      client: { id: 5, branchId: 2 },
      employee: { id: 8 },
      lines: [{ service: { id: 21 }, quantity: 1 }],
    });
    const raw = localStorage.getItem(offlineSaleQueueStorageKey(input.idempotencyKey)) ?? '';
    expect(raw).not.toContain('01012345678');
    expect(raw).not.toContain('منى أحمد');
    expect(raw).not.toContain('سارة علي');
  });

  it('ignores a malformed recovery draft without discarding the valid sale payload', () => {
    const input = sale();
    const key = offlineSaleQueueStorageKey(input.idempotencyKey);
    enqueueOfflineSale({ owner, input });
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({
      ...stored,
      recoveryDraft: { client: { id: 5, branchId: 2 }, lines: 'invalid' },
    }));

    expect(listOfflineSales(owner)).toEqual([
      expect.objectContaining({ input }),
    ]);
    expect(listOfflineSales(owner)[0]).not.toHaveProperty('recoveryDraft');
  });

  it('removes a conflicted predecessor only after its replacement is durable', () => {
    const previous = sale();
    enqueueOfflineSale({ owner, input: previous });
    markOfflineSaleFailed(previous.idempotencyKey, new ApiError(409, {
      code: 'INSUFFICIENT_STOCK', message: 'تغير المخزون',
    }));
    const replacement = sale();

    expect(enqueueOfflineSale({
      owner,
      input: replacement,
      replacesIdempotencyKey: previous.idempotencyKey,
    })).not.toBeNull();
    expect(listOfflineSales(owner).map((item) => item.input.idempotencyKey)).toEqual([
      replacement.idempotencyKey,
    ]);
  });

  it('notifies the current tab after every durable queue change', () => {
    const initialVersion = getOfflineSaleQueueVersion();
    let changes = 0;
    const unsubscribe = subscribeOfflineSaleQueue(() => { changes += 1; });
    const input = sale();

    enqueueOfflineSale({ owner, input });
    markOfflineSaleSyncing(input.idempotencyKey);
    removeOfflineSale(input.idempotencyKey);
    unsubscribe();

    expect(changes).toBe(3);
    expect(getOfflineSaleQueueVersion()).toBe(initialVersion + 3);
  });

  it('caps exponential automatic retry delays', () => {
    expect(offlineSaleRetryDelayMs(1)).toBe(1_000);
    expect(offlineSaleRetryDelayMs(2)).toBe(2_000);
    expect(offlineSaleRetryDelayMs(20)).toBe(30_000);
  });
});

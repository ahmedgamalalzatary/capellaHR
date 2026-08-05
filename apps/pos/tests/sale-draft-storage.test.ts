import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireSaleDraftTab,
  clearAllSaleDrafts,
  readSaleDraft,
  removeSaleDraft,
  saleDraftStorageKey,
  writeSaleDraft,
  type SaleDraft,
  type SaleDraftOwner,
} from '../src/features/sales/sale-draft-storage';

const owner: SaleDraftOwner = {
  accountId: 3,
  role: 'cashier',
  branchId: 2,
  cashierSessionId: 13,
};

const draft: SaleDraft = {
  client: {
    id: 5,
    branchId: 2,
    fullName: 'منى أحمد',
    phone: '01012345678',
    createdAt: '',
    updatedAt: '',
  },
  employee: { id: 8, employeeCode: 1008, fullName: 'سارة علي', branchId: 2 },
  lines: [{
    service: {
      id: 21,
      branchId: 2,
      categoryId: 1,
      categoryName: 'شعر',
      categoryIsActive: true,
      name: 'صبغة شعر',
      description: null,
      price: '200.00',
      commissionPercent: '10.00',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    },
    quantity: 1,
  }],
  discountKind: 'percentage',
  discountValue: '10.00',
  taxKind: 'fixed',
  taxValue: '5.00',
  payments: { cash: '185.00', visa: '', instapay: '', vodafone_cash: '' },
  paymentsTouched: true,
  idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};

describe('sale draft storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a draft only within its account, branch, and session workspace', () => {
    expect(writeSaleDraft(owner, draft)).toBe(true);
    expect(readSaleDraft(owner)).toEqual({
      ...draft,
      client: { id: draft.client!.id, branchId: draft.client!.branchId },
    });
    expect(readSaleDraft({ ...owner, cashierSessionId: 14 })).toBeNull();
    expect(saleDraftStorageKey(owner, draft.idempotencyKey)).toContain(
      `cashier:3:2:13:${draft.idempotencyKey}`,
    );
  });

  it('persists only client identifiers, not client personal data', () => {
    expect(writeSaleDraft(owner, draft)).toBe(true);

    const stored = sessionStorage.getItem(saleDraftStorageKey(owner, draft.idempotencyKey));
    expect(localStorage.getItem(saleDraftStorageKey(owner, draft.idempotencyKey))).toBeNull();
    expect(stored).not.toContain(draft.client!.phone);
    expect(stored).not.toContain(draft.client!.fullName);
    expect(JSON.parse(stored!).draft.client).toEqual({ id: 5, branchId: 2 });
  });

  it('removes only the requested workspace draft', () => {
    const anotherOwner = { ...owner, cashierSessionId: 14 };
    writeSaleDraft(owner, draft);
    writeSaleDraft(anotherOwner, { ...draft, idempotencyKey: crypto.randomUUID() });

    expect(removeSaleDraft(owner, draft.idempotencyKey)).toBe(true);
    expect(readSaleDraft(owner)).toBeNull();
    expect(readSaleDraft(anotherOwner)).not.toBeNull();
  });

  it('keeps concurrent drafts in the same workspace isolated by idempotency key', () => {
    const secondDraft = { ...draft, idempotencyKey: crypto.randomUUID() };

    writeSaleDraft(owner, draft);
    writeSaleDraft(owner, secondDraft);

    expect(sessionStorage.getItem(saleDraftStorageKey(owner, draft.idempotencyKey))).not.toBeNull();
    expect(sessionStorage.getItem(saleDraftStorageKey(owner, secondDraft.idempotencyKey))).not.toBeNull();
    expect(removeSaleDraft(owner, draft.idempotencyKey)).toBe(true);
    expect(sessionStorage.getItem(saleDraftStorageKey(owner, secondDraft.idempotencyKey))).not.toBeNull();
  });

  it('gives a duplicated browser tab a fresh draft selection lease', async () => {
    const heldLocks = new Set<string>();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: unknown,
          callback: (lock: { name: string } | null) => Promise<void> | void,
        ) => {
          if (heldLocks.has(name)) return callback(null);
          heldLocks.add(name);
          try {
            return await callback({ name });
          } finally {
            heldLocks.delete(name);
          }
        },
      },
    });
    sessionStorage.setItem('capella:sale-draft-tab', 'copied-tab');
    writeSaleDraft(owner, draft);

    const releaseOriginal = await acquireSaleDraftTab(owner);
    const releaseDuplicate = await acquireSaleDraftTab(owner);

    expect(sessionStorage.getItem('capella:sale-draft-tab')).not.toBe('copied-tab');
    expect(readSaleDraft(owner)).toBeNull();
    releaseDuplicate();
    releaseOriginal();
  });

  it('expires stale drafts so abandoned shifts do not retain client data indefinitely', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    writeSaleDraft(owner, draft);

    vi.setSystemTime(new Date('2026-08-05T10:00:01.000Z'));
    vi.runOnlyPendingTimers();

    expect(sessionStorage.getItem(saleDraftStorageKey(owner, draft.idempotencyKey))).toBeNull();
    expect(readSaleDraft(owner)).toBeNull();
    vi.useRealTimers();
  });

  it('clears every stored sale draft and active selection during logout', () => {
    const anotherOwner = { ...owner, cashierSessionId: 14 };
    writeSaleDraft(owner, draft);
    writeSaleDraft(anotherOwner, { ...draft, idempotencyKey: crypto.randomUUID() });
    sessionStorage.setItem('unrelated', 'keep');

    clearAllSaleDrafts();

    expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)))
      .toEqual(['unrelated']);
    expect(sessionStorage.getItem(`${saleDraftStorageKey(owner)}:active`)).toBeNull();
    expect(sessionStorage.getItem(`${saleDraftStorageKey(anotherOwner)}:active`)).toBeNull();
  });

  it('rejects timestamp-less draft records so client data always has a bounded lifetime', () => {
    const key = saleDraftStorageKey(owner, draft.idempotencyKey);
    sessionStorage.setItem(key, JSON.stringify(draft));
    sessionStorage.setItem(`${saleDraftStorageKey(owner)}:active`, draft.idempotencyKey);

    expect(readSaleDraft(owner)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('falls back to and migrates a legacy draft when the active selection is stale', () => {
    const legacyKey = saleDraftStorageKey(owner);
    sessionStorage.setItem(legacyKey, JSON.stringify({ savedAt: Date.now(), draft }));
    sessionStorage.setItem(`${legacyKey}:active`, 'missing-draft');

    expect(readSaleDraft(owner)).toEqual({
      ...draft,
      client: { id: draft.client!.id, branchId: draft.client!.branchId },
    });
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
    expect(sessionStorage.getItem(`${legacyKey}:active`)).toBe(draft.idempotencyKey);
    expect(sessionStorage.getItem(saleDraftStorageKey(owner, draft.idempotencyKey))).not.toBeNull();
  });

  it('fails closed for malformed or unavailable browser storage', () => {
    const malformedKey = saleDraftStorageKey(owner);
    sessionStorage.setItem(malformedKey, '{bad json');
    expect(readSaleDraft(owner)).toBeNull();
    expect(sessionStorage.getItem(malformedKey)).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(writeSaleDraft(owner, draft)).toBe(false);
  });

  it('does not reject hydration when tab-lease storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    await expect(acquireSaleDraftTab(owner)).resolves.toEqual(expect.any(Function));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireSaleDraftTab,
  clearAllSaleDrafts,
  listSaleDrafts,
  readActiveSaleDraftId,
  readSaleDraft,
  removeSaleDraft,
  saleDraftStorageKey,
  setActiveSaleDraftId,
  subscribeSaleDrafts,
  writeSaleDraft,
  type SaleDraft,
  type SaleDraftOwner,
} from '../src/features/sales/sale-draft-storage';
import type { ServiceListItem } from '../src/features/catalog';

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
  seller: { id: 9, employeeCode: 1009, fullName: 'أحمد جمال' },
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
    unitPrice: '200.00',
    employee: { id: 11, employeeCode: 1011, fullName: 'هدى محمود', branchId: 2 },
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
  it('keeps the employee each service line was assigned to', () => {
    writeSaleDraft(owner, draft);
    expect(readSaleDraft(owner)?.lines[0]?.employee)
      .toEqual({ id: 11, employeeCode: 1011, fullName: 'هدى محمود', branchId: 2 });
  });

  it('refuses a stored line whose employee is not a real employee record', () => {
    writeSaleDraft(owner, {
      ...draft,
      lines: [{ ...draft.lines[0]!, employee: { id: 'eight' } as never }],
    });
    expect(readSaleDraft(owner)).toBeNull();
  });

  it('accepts an older draft whose lines name no employee', () => {
    const { employee: _performer, ...legacyLine } = draft.lines[0]!;
    const legacy = { ...draft, lines: [legacyLine] };
    writeSaleDraft(owner, legacy);
    expect(readSaleDraft(owner)?.lines[0]?.service.id).toBe(21);
  });

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

  it('keeps the entered unit price for an open-price service', () => {
    const openPriceDraft: SaleDraft = {
      ...draft,
      lines: [{
        ...draft.lines[0]!,
        service: { ...draft.lines[0]!.service, price: null } as ServiceListItem,
        unitPrice: '800',
      }],
    };

    expect(writeSaleDraft(owner, openPriceDraft)).toBe(true);
    expect(readSaleDraft(owner)?.lines[0]?.unitPrice).toBe('800');
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

  /** Another document already holding the inherited lock is the real duplicate. */
  const stubLocks = (heldByAnotherDocument: string[] = []) => {
    const heldLocks = new Set<string>(heldByAnotherDocument);
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
  };

  it('keeps the draft when the sale screen is left and reopened in the same tab', async () => {
    stubLocks();
    sessionStorage.setItem('capella:sale-draft-tab', 'this-tab');
    writeSaleDraft(owner, draft);

    // Leaving /sales releases the lease; returning acquires it again.
    const first = await acquireSaleDraftTab(owner);
    first();
    const second = await acquireSaleDraftTab(owner);

    expect(sessionStorage.getItem('capella:sale-draft-tab')).toBe('this-tab');
    expect(readSaleDraft(owner)).not.toBeNull();
    second();
  });

  it('gives a duplicated browser tab a fresh draft selection lease', async () => {
    // A duplicate is a second document that inherited the sessionStorage of the
    // first, so it is loaded fresh while the original still holds the lock.
    stubLocks(['capella:sale-draft-tab:copied-tab']);
    sessionStorage.setItem('capella:sale-draft-tab', 'copied-tab');
    writeSaleDraft(owner, draft);
    vi.resetModules();
    const duplicate = await import('../src/features/sales/sale-draft-storage');

    await duplicate.acquireSaleDraftTab(owner);

    expect(sessionStorage.getItem('capella:sale-draft-tab')).not.toBe('copied-tab');
    expect(readSaleDraft(owner)).toBeNull();
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

  it('removes a decoded legacy draft before announcing its migrated replacement', () => {
    const legacyKey = saleDraftStorageKey(owner);
    sessionStorage.setItem(legacyKey, JSON.stringify({ savedAt: Date.now(), draft }));
    const legacyValuesAtNotification: Array<string | null> = [];
    const unsubscribe = subscribeSaleDrafts(() => {
      legacyValuesAtNotification.push(sessionStorage.getItem(legacyKey));
    });

    expect(readSaleDraft(owner)?.idempotencyKey).toBe(draft.idempotencyKey);

    expect(legacyValuesAtNotification).toEqual([null]);
    unsubscribe();
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

  it('lists parked sales in the order they were opened, however they are edited', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T10:00:00.000Z'));
    const second: SaleDraft = { ...draft, idempotencyKey: crypto.randomUUID() };
    writeSaleDraft(owner, draft);
    vi.setSystemTime(new Date('2026-09-02T10:05:00.000Z'));
    writeSaleDraft(owner, second);
    // Typing into the older sale must not push it behind the newer one.
    vi.setSystemTime(new Date('2026-09-02T10:09:00.000Z'));
    writeSaleDraft(owner, { ...draft, taxValue: '7.00' });

    expect(listSaleDrafts(owner).map((record) => record.draft.idempotencyKey))
      .toEqual([draft.idempotencyKey, second.idempotencyKey]);
    vi.useRealTimers();
  });

  it('lists only the sales parked by this account in this branch and shift', () => {
    const otherShift = { ...owner, cashierSessionId: 14 };
    writeSaleDraft(owner, draft);
    writeSaleDraft(otherShift, { ...draft, idempotencyKey: crypto.randomUUID() });

    expect(listSaleDrafts(owner).map((record) => record.draft.idempotencyKey))
      .toEqual([draft.idempotencyKey]);
    expect(listSaleDrafts(otherShift)).toHaveLength(1);
  });

  it('ignores a parked record filed under a key that is not its own', () => {
    writeSaleDraft(owner, draft);
    const misfiled = saleDraftStorageKey(owner, crypto.randomUUID());
    sessionStorage.setItem(
      misfiled,
      sessionStorage.getItem(saleDraftStorageKey(owner, draft.idempotencyKey))!,
    );

    expect(listSaleDrafts(owner).map((record) => record.draft.idempotencyKey))
      .toEqual([draft.idempotencyKey]);
  });

  it('reopens the parked sale the cashier was last serving', () => {
    const second: SaleDraft = { ...draft, idempotencyKey: crypto.randomUUID() };
    writeSaleDraft(owner, draft);
    writeSaleDraft(owner, second);
    expect(readActiveSaleDraftId(owner)).toBe(second.idempotencyKey);

    expect(setActiveSaleDraftId(owner, draft.idempotencyKey)).toBe(true);

    expect(readActiveSaleDraftId(owner)).toBe(draft.idempotencyKey);
    expect(readSaleDraft(owner)?.idempotencyKey).toBe(draft.idempotencyKey);
  });

  it('leaves no sale selected once the cashier starts a fresh one', () => {
    writeSaleDraft(owner, draft);

    expect(setActiveSaleDraftId(owner, null)).toBe(true);

    expect(readActiveSaleDraftId(owner)).toBeNull();
    expect(listSaleDrafts(owner)).toHaveLength(1);
  });

  it('announces every change so the parked-sale bar can follow it', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSaleDrafts(listener);

    writeSaleDraft(owner, draft);
    expect(listener).toHaveBeenCalledTimes(1);
    removeSaleDraft(owner, draft.idempotencyKey);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    writeSaleDraft(owner, draft);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

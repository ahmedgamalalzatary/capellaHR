import type { PaymentMethod } from '@capella/contracts';

import type { ServiceListItem } from '@/features/catalog';
import type { ProductSaleItem } from '@/features/products';
import type { Client } from '@/features/clients';
import type { AssignableEmployee } from '@/features/employee-assignment';
import type { BranchCashierRosterMember } from '@/features/cashier-accounts';
import { createUuid } from '@/lib/uuid';

export type SaleDraftOwner = {
  accountId: number | null;
  role: 'admin' | 'cashier';
  branchId: number;
  cashierSessionId: number;
};

export type SaleDraft = {
  client: Client | null;
  employee: AssignableEmployee | null;
  seller: BranchCashierRosterMember | null;
  lines: Array<{
    service: ServiceListItem | ProductSaleItem;
    quantity: number;
    unitPrice: string;
    itemType?: 'service' | 'product';
    /** Who performed this service; older drafts carry it only at the top. */
    employee?: AssignableEmployee | null;
  }>;
  discountKind: 'percentage' | 'fixed';
  discountValue: string;
  taxKind: 'percentage' | 'fixed';
  taxValue: string;
  payments: Record<PaymentMethod, string>;
  paymentsTouched: boolean;
  idempotencyKey: string;
};

export type StoredSaleDraft = Omit<SaleDraft, 'client'> & {
  client: Pick<Client, 'id' | 'branchId'> | null;
};

const PREFIX = 'capella:sale-draft';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
const TAB_KEY = 'capella:sale-draft-tab';
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

const workspaceKey = (owner: SaleDraftOwner) => [
  PREFIX,
  owner.role,
  owner.accountId ?? 'admin',
  owner.branchId,
  owner.cashierSessionId,
].join(':');

export const saleDraftStorageKey = (owner: SaleDraftOwner, idempotencyKey?: string) => (
  idempotencyKey ? `${workspaceKey(owner)}:${idempotencyKey}` : workspaceKey(owner)
);

const activeDraftKey = (owner: SaleDraftOwner) => `${workspaceKey(owner)}:active`;

const holdTabLock = (tabId: string) => new Promise<(() => void) | null>((resolve, reject) => {
  navigator.locks.request(
    `${TAB_KEY}:${tabId}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      await new Promise<void>((release) => resolve(release));
    },
  ).catch(reject);
});

/**
 * The lease belongs to the document, not to one mounting of the sale screen, and it
 * is never handed back: a browser tab keeps its identity until it is closed.
 *
 * Releasing on unmount used to make leaving /sales and returning look exactly like a
 * duplicated tab — the lock is freed asynchronously, so the returning screen found it
 * still held, minted a new identity and dropped the pointer to the draft it was about
 * to restore. Only a genuinely different document can now trigger that reset.
 */
let tabLease: Promise<void> | null = null;

const claimTabIdentity = async (owner: SaleDraftOwner) => {
  let tabId = sessionStorage.getItem(TAB_KEY) ?? createUuid();
  sessionStorage.setItem(TAB_KEY, tabId);
  if (await holdTabLock(tabId)) return;

  // The id came from a duplicated tab, whose document still holds the lock.
  tabId = createUuid();
  sessionStorage.setItem(TAB_KEY, tabId);
  sessionStorage.removeItem(activeDraftKey(owner));
  await holdTabLock(tabId);
};

export const acquireSaleDraftTab = async (owner: SaleDraftOwner): Promise<() => void> => {
  if (typeof window === 'undefined' || !navigator.locks) return () => undefined;
  try {
    tabLease ??= claimTabIdentity(owner);
    await tabLease;
  } catch {
    tabLease = null;
  }
  return () => undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const hasIdentity = (value: unknown): value is Record<string, unknown> & {
  id: number;
  fullName: string;
  branchId: number;
} => isRecord(value)
  && typeof value.id === 'number'
  && typeof value.fullName === 'string'
  && typeof value.branchId === 'number';

const isSaleDraft = (value: unknown): value is StoredSaleDraft => {
  if (!isRecord(value)) return false;
  const payments = value.payments;
  return (value.client === null || (isRecord(value.client)
    && typeof value.client.id === 'number'
    && typeof value.client.branchId === 'number'))
    && (value.employee === null || (hasIdentity(value.employee)
      && typeof value.employee.employeeCode === 'number'))
    // Drafts saved before sellers existed may lack the field entirely.
    && (value.seller === undefined || value.seller === null || (isRecord(value.seller)
      && typeof value.seller.id === 'number'
      && typeof value.seller.employeeCode === 'number'
      && typeof value.seller.fullName === 'string'))
    && Array.isArray(value.lines)
    && value.lines.every((line) => isRecord(line)
      && Number.isInteger(line.quantity)
      && Number(line.quantity) > 0
      && (line.itemType === undefined || line.itemType === 'service' || line.itemType === 'product')
      && isRecord(line.service)
      && typeof line.service.id === 'number'
      && typeof line.service.name === 'string'
      && (typeof line.service.price === 'string' || line.service.price === null)
      && (line.unitPrice === undefined || typeof line.unitPrice === 'string')
      // Drafts saved before per-line assignment carry no employee on the line.
      && (line.employee === undefined || line.employee === null
        || (hasIdentity(line.employee) && typeof line.employee.employeeCode === 'number')))
    && (value.discountKind === 'percentage' || value.discountKind === 'fixed')
    && typeof value.discountValue === 'string'
    && (value.taxKind === 'percentage' || value.taxKind === 'fixed')
    && typeof value.taxValue === 'string'
    && isRecord(payments)
    && ['cash', 'visa', 'instapay', 'vodafone_cash'].every(
      (method) => typeof payments[method] === 'string',
    )
    && typeof value.paymentsTouched === 'boolean'
    && typeof value.idempotencyKey === 'string';
};

export const sanitizeSaleDraft = (draft: StoredSaleDraft | SaleDraft): StoredSaleDraft => ({
  ...draft,
  client: draft.client ? { id: draft.client.id, branchId: draft.client.branchId } : null,
  lines: draft.lines.map((line) => ({
    ...line,
    unitPrice: line.unitPrice ?? line.service.price ?? '',
  })),
});

export const parseStoredSaleDraft = (value: unknown): StoredSaleDraft | null => (
  isSaleDraft(value) ? sanitizeSaleDraft(value) : null
);

const decodeStoredDraft = (stored: string): { draft: StoredSaleDraft; savedAt: number } | null => {
  const parsed: unknown = JSON.parse(stored);
  if (!isRecord(parsed) || typeof parsed.savedAt !== 'number') {
    return null;
  }
  const draft = parseStoredSaleDraft(parsed.draft);
  return draft ? { draft, savedAt: parsed.savedAt } : null;
};

const cancelExpiry = (key: string) => {
  const timer = expiryTimers.get(key);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(key);
};

const scheduleExpiry = (key: string, savedAt: number) => {
  cancelExpiry(key);
  const remaining = savedAt + DRAFT_TTL_MS - Date.now();
  if (remaining <= 0) {
    sessionStorage.removeItem(key);
    return;
  }
  expiryTimers.set(key, setTimeout(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // A visibility/pageshow prune will retry if storage becomes available.
    } finally {
      expiryTimers.delete(key);
    }
  }, remaining));
};

const pruneExpiredDrafts = () => {
  const legacyKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
  for (const key of legacyKeys) {
    if (key?.startsWith(`${PREFIX}:`)) localStorage.removeItem(key);
  }
  const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
  for (const key of keys) {
    if (!key?.startsWith(`${PREFIX}:`) || key.endsWith(':active')) continue;
    const stored = sessionStorage.getItem(key);
    if (!stored) continue;
    try {
      const decoded = decodeStoredDraft(stored);
      if (!decoded || Date.now() - decoded.savedAt >= DRAFT_TTL_MS) {
        sessionStorage.removeItem(key);
        cancelExpiry(key);
      } else {
        sessionStorage.setItem(key, JSON.stringify(decoded));
        scheduleExpiry(key, decoded.savedAt);
      }
    } catch {
      sessionStorage.removeItem(key);
      cancelExpiry(key);
    }
  }
};

const enforceDraftRetention = () => {
  try {
    pruneExpiredDrafts();
  } catch {
    // Storage is unavailable; draft operations continue to fail closed.
  }
};

if (typeof window !== 'undefined') {
  enforceDraftRetention();
  window.addEventListener('pageshow', enforceDraftRetention);
  window.addEventListener('focus', enforceDraftRetention);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) enforceDraftRetention();
  });
}

export const readSaleDraft = (owner: SaleDraftOwner): StoredSaleDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    pruneExpiredDrafts();
    const activeId = sessionStorage.getItem(activeDraftKey(owner));
    if (activeId) {
      const stored = sessionStorage.getItem(saleDraftStorageKey(owner, activeId));
      if (!stored) {
        sessionStorage.removeItem(activeDraftKey(owner));
      } else {
        return decodeStoredDraft(stored)?.draft ?? null;
      }
    }

    const legacy = sessionStorage.getItem(saleDraftStorageKey(owner));
    if (!legacy) return null;
    const decoded = decodeStoredDraft(legacy);
    if (!decoded) return null;
    if (writeSaleDraft(owner, decoded.draft)) sessionStorage.removeItem(saleDraftStorageKey(owner));
    return decoded.draft;
  } catch {
    return null;
  }
};

export const writeSaleDraft = (owner: SaleDraftOwner, draft: SaleDraft | StoredSaleDraft) => {
  const activeKey = activeDraftKey(owner);
  let previousActive: string | null = null;
  try {
    pruneExpiredDrafts();
    previousActive = sessionStorage.getItem(activeKey);
    sessionStorage.setItem(activeKey, draft.idempotencyKey);
    const key = saleDraftStorageKey(owner, draft.idempotencyKey);
    const savedAt = Date.now();
    sessionStorage.setItem(key, JSON.stringify({ savedAt, draft: sanitizeSaleDraft(draft) }));
    scheduleExpiry(key, savedAt);
    return true;
  } catch {
    try {
      if (previousActive === null) sessionStorage.removeItem(activeKey);
      else sessionStorage.setItem(activeKey, previousActive);
    } catch {
      // Storage is unavailable; the caller will surface the failure.
    }
    return false;
  }
};

export const removeSaleDraft = (owner: SaleDraftOwner, idempotencyKey: string) => {
  try {
    const key = saleDraftStorageKey(owner, idempotencyKey);
    sessionStorage.removeItem(key);
    cancelExpiry(key);
    const activeKey = activeDraftKey(owner);
    if (sessionStorage.getItem(activeKey) === idempotencyKey) {
      sessionStorage.removeItem(activeKey);
    }
    return true;
  } catch {
    return false;
  }
};

export const clearAllSaleDrafts = () => {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (key?.startsWith(`${PREFIX}:`)) storage.removeItem(key);
      }
    } catch {
      // Continue cleaning other stores and timers when one store is unavailable.
    }
  }
  for (const key of expiryTimers.keys()) cancelExpiry(key);
};

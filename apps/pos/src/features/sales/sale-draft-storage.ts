import type { PaymentMethod } from '@capella/contracts';

import type { ServiceListItem } from '@/features/catalog';
import type { Client } from '@/features/clients';
import type { AssignableEmployee } from '@/features/employee-assignment';

export type SaleDraftOwner = {
  accountId: number | null;
  role: 'admin' | 'cashier';
  branchId: number;
  cashierSessionId: number;
};

export type SaleDraft = {
  client: Client | null;
  employee: AssignableEmployee | null;
  lines: Array<{ service: ServiceListItem; quantity: number }>;
  discountKind: 'percentage' | 'fixed';
  discountValue: string;
  taxKind: 'percentage' | 'fixed';
  taxValue: string;
  payments: Record<PaymentMethod, string>;
  paymentsTouched: boolean;
  idempotencyKey: string;
};

type StoredSaleDraft = Omit<SaleDraft, 'client'> & {
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

export const acquireSaleDraftTab = async (owner: SaleDraftOwner): Promise<() => void> => {
  if (typeof window === 'undefined' || !navigator.locks) return () => undefined;
  try {
    let tabId = sessionStorage.getItem(TAB_KEY) ?? crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, tabId);
    let release = await holdTabLock(tabId);
    if (release) return release;

    tabId = crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, tabId);
    sessionStorage.removeItem(activeDraftKey(owner));
    release = await holdTabLock(tabId);
    return release ?? (() => undefined);
  } catch {
    return () => undefined;
  }
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
    && Array.isArray(value.lines)
    && value.lines.every((line) => isRecord(line)
      && Number.isInteger(line.quantity)
      && Number(line.quantity) > 0
      && isRecord(line.service)
      && typeof line.service.id === 'number'
      && typeof line.service.name === 'string'
      && typeof line.service.price === 'string')
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

const sanitizeDraft = (draft: StoredSaleDraft | SaleDraft): StoredSaleDraft => ({
  ...draft,
  client: draft.client ? { id: draft.client.id, branchId: draft.client.branchId } : null,
});

const decodeStoredDraft = (stored: string): { draft: StoredSaleDraft; savedAt: number } | null => {
  const parsed: unknown = JSON.parse(stored);
  if (!isRecord(parsed) || typeof parsed.savedAt !== 'number' || !isSaleDraft(parsed.draft)) {
    return null;
  }
  return { draft: sanitizeDraft(parsed.draft), savedAt: parsed.savedAt };
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
    sessionStorage.setItem(key, JSON.stringify({ savedAt, draft: sanitizeDraft(draft) }));
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

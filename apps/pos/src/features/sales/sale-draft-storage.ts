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

const PREFIX = 'capella:sale-draft';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
const TAB_KEY = 'capella:sale-draft-tab';

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

const isSaleDraft = (value: unknown): value is SaleDraft => {
  if (!isRecord(value)) return false;
  const payments = value.payments;
  return (value.client === null || (hasIdentity(value.client) && typeof value.client.phone === 'string'))
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

const decodeStoredDraft = (stored: string): { draft: SaleDraft; savedAt: number } | null => {
  const parsed: unknown = JSON.parse(stored);
  if (!isRecord(parsed) || typeof parsed.savedAt !== 'number' || !isSaleDraft(parsed.draft)) {
    return null;
  }
  return { draft: parsed.draft, savedAt: parsed.savedAt };
};

const pruneExpiredDrafts = () => {
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
  for (const key of keys) {
    if (!key?.startsWith(`${PREFIX}:`)) continue;
    const stored = localStorage.getItem(key);
    if (!stored) continue;
    try {
      const decoded = decodeStoredDraft(stored);
      if (!decoded || Date.now() - decoded.savedAt > DRAFT_TTL_MS) {
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
};

export const readSaleDraft = (owner: SaleDraftOwner): SaleDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    pruneExpiredDrafts();
    const activeId = sessionStorage.getItem(activeDraftKey(owner));
    if (activeId) {
      const stored = localStorage.getItem(saleDraftStorageKey(owner, activeId));
      if (!stored) {
        sessionStorage.removeItem(activeDraftKey(owner));
        return null;
      }
      return decodeStoredDraft(stored)?.draft ?? null;
    }

    const legacy = localStorage.getItem(saleDraftStorageKey(owner));
    if (!legacy) return null;
    const decoded = decodeStoredDraft(legacy);
    if (!decoded) return null;
    if (writeSaleDraft(owner, decoded.draft)) localStorage.removeItem(saleDraftStorageKey(owner));
    return decoded.draft;
  } catch {
    return null;
  }
};

export const writeSaleDraft = (owner: SaleDraftOwner, draft: SaleDraft) => {
  const activeKey = activeDraftKey(owner);
  let previousActive: string | null = null;
  try {
    pruneExpiredDrafts();
    previousActive = sessionStorage.getItem(activeKey);
    sessionStorage.setItem(activeKey, draft.idempotencyKey);
    localStorage.setItem(
      saleDraftStorageKey(owner, draft.idempotencyKey),
      JSON.stringify({ savedAt: Date.now(), draft }),
    );
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
    localStorage.removeItem(saleDraftStorageKey(owner, idempotencyKey));
    const activeKey = activeDraftKey(owner);
    if (sessionStorage.getItem(activeKey) === idempotencyKey) {
      sessionStorage.removeItem(activeKey);
    }
    return true;
  } catch {
    return false;
  }
};

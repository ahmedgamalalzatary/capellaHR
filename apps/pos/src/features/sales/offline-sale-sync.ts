import type { CompleteSaleInput, PublicInvoiceDto } from '@capella/contracts';

import {
  listOfflineSales,
  markOfflineSaleFailed,
  markOfflineSaleSyncing,
  recoverInterruptedOfflineSales,
  removeOfflineSale,
  type OfflineSaleOwner,
} from './offline-sale-queue';

export type OfflineSaleSyncResult = {
  confirmed: Array<{ idempotencyKey: string; invoice: PublicInvoiceDto }>;
  failed: string[];
  conflicts: string[];
};

const activeSynchronizations = new Map<string, Promise<OfflineSaleSyncResult>>();
const FALLBACK_LEASE_PREFIX = 'capella:offline-sale-sync-lease:v1:';
const FALLBACK_LEASE_MS = 30_000;
const FALLBACK_LEASE_SETTLE_MS = 20;

const ownerKey = (owner: OfflineSaleOwner) => [
  owner.role,
  owner.accountId ?? 'admin',
  owner.branchId,
  owner.cashierSessionId,
].join(':');

export const offlineSaleSyncLeaseStorageKey = (owner: OfflineSaleOwner) => (
  `${FALLBACK_LEASE_PREFIX}${ownerKey(owner)}`
);

const emptyResult = (): OfflineSaleSyncResult => ({
  confirmed: [],
  failed: [],
  conflicts: [],
});

const readFallbackLease = (key: string) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const lease = parsed as { token?: unknown; expiresAt?: unknown };
    return typeof lease.token === 'string' && typeof lease.expiresAt === 'number'
      ? { token: lease.token, expiresAt: lease.expiresAt }
      : null;
  } catch {
    return null;
  }
};

const acquireFallbackLease = async (owner: OfflineSaleOwner) => {
  const key = offlineSaleSyncLeaseStorageKey(owner);
  const current = readFallbackLease(key);
  if (current && current.expiresAt > Date.now()) return null;
  const token = crypto.randomUUID();
  const writeLease = () => localStorage.setItem(key, JSON.stringify({
    token,
    expiresAt: Date.now() + FALLBACK_LEASE_MS,
  }));
  try {
    writeLease();
    await new Promise((resolve) => window.setTimeout(resolve, FALLBACK_LEASE_SETTLE_MS));
    if (readFallbackLease(key)?.token !== token) return null;
    const heartbeat = window.setInterval(() => {
      try {
        if (readFallbackLease(key)?.token !== token) {
          window.clearInterval(heartbeat);
          return;
        }
        writeLease();
      } catch {
        window.clearInterval(heartbeat);
      }
    }, FALLBACK_LEASE_MS / 3);
    return () => {
      window.clearInterval(heartbeat);
      if (readFallbackLease(key)?.token === token) localStorage.removeItem(key);
    };
  } catch {
    return null;
  }
};

const replay = async ({
  owner,
  submit,
}: {
  owner: OfflineSaleOwner;
  submit: (input: CompleteSaleInput) => Promise<PublicInvoiceDto>;
}) => {
  const result = emptyResult();
  recoverInterruptedOfflineSales(owner);
  const attempted = new Set<string>();
  while (navigator.onLine) {
    const item = listOfflineSales(owner).find((candidate) => (
      candidate.state !== 'conflict'
      && !attempted.has(candidate.input.idempotencyKey)
    ));
    if (!item) break;
    attempted.add(item.input.idempotencyKey);
    if (!markOfflineSaleSyncing(item.input.idempotencyKey)) continue;
    try {
      const confirmed = await submit(item.input);
      if (removeOfflineSale(item.input.idempotencyKey)) {
        result.confirmed.push({ idempotencyKey: item.input.idempotencyKey, invoice: confirmed });
      }
    } catch (error) {
      const failed = markOfflineSaleFailed(item.input.idempotencyKey, error);
      if (!failed) continue;
      if (failed.state === 'conflict') {
        result.conflicts.push(item.input.idempotencyKey);
        continue;
      }
      result.failed.push(item.input.idempotencyKey);
      break;
    }
  }
  return result;
};

export const synchronizeOfflineSales = ({
  owner,
  submit,
}: {
  owner: OfflineSaleOwner;
  submit: (input: CompleteSaleInput) => Promise<PublicInvoiceDto>;
}): Promise<OfflineSaleSyncResult> => {
  if (typeof window === 'undefined' || !navigator.onLine) return Promise.resolve(emptyResult());
  const key = ownerKey(owner);
  const active = activeSynchronizations.get(key);
  if (active) return active;

  const run = async () => {
    if (navigator.locks) {
      return navigator.locks.request(`capella:offline-sale-sync:${key}`, () => replay({ owner, submit }));
    }
    const releaseLease = await acquireFallbackLease(owner);
    if (!releaseLease) return emptyResult();
    try {
      return await replay({ owner, submit });
    } finally {
      releaseLease();
    }
  };
  const synchronization = Promise.resolve()
    .then(run)
    .finally(() => activeSynchronizations.delete(key));
  activeSynchronizations.set(key, synchronization);
  return synchronization;
};

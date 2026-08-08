import { completeSaleSchema, type CompleteSaleInput } from '@capella/contracts';

import { ApiError } from '@/lib/api/client';

import {
  parseStoredSaleDraft,
  sanitizeSaleDraft,
  type SaleDraft,
  type StoredSaleDraft,
} from './sale-draft-storage';

export type OfflineSaleOwner = {
  accountId: number | null;
  role: 'admin' | 'cashier';
  branchId: number;
  cashierSessionId: number;
};

export type OfflineSaleFailureKind = 'retryable' | 'conflict';
export type OfflineSaleState = 'pending' | 'syncing' | 'failed' | 'conflict';

export type OfflineSaleQueueItem = {
  version: 1;
  owner: OfflineSaleOwner;
  input: CompleteSaleInput;
  state: OfflineSaleState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  failure: {
    kind: OfflineSaleFailureKind;
    code: string;
    message: string;
  } | null;
  recoveryDraft?: StoredSaleDraft;
};

const QUEUE_PREFIX = 'capella:offline-sale:v1:';
const LEGACY_KEY = 'capella:pending-sale';
const LEGACY_PREFIX = `${LEGACY_KEY}:`;
const QUEUE_CHANGE_EVENT = 'capella:offline-sale-queue-change';

const notifyQueueChange = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_CHANGE_EVENT));
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const parseOwner = (value: unknown): OfflineSaleOwner | null => {
  if (!isRecord(value)
    || (value.role !== 'admin' && value.role !== 'cashier')
    || (value.accountId !== null && !Number.isInteger(value.accountId))
    || !Number.isInteger(value.branchId)
    || Number(value.branchId) <= 0
    || !Number.isInteger(value.cashierSessionId)
    || Number(value.cashierSessionId) <= 0) return null;
  return {
    accountId: value.accountId as number | null,
    role: value.role,
    branchId: Number(value.branchId),
    cashierSessionId: Number(value.cashierSessionId),
  };
};

const parseFailure = (value: unknown): OfflineSaleQueueItem['failure'] => {
  if (value === null) return null;
  if (!isRecord(value)
    || (value.kind !== 'retryable' && value.kind !== 'conflict')
    || typeof value.code !== 'string'
    || typeof value.message !== 'string') return null;
  return { kind: value.kind, code: value.code, message: value.message };
};

const parseQueueItem = (value: string | null): OfflineSaleQueueItem | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)
      || parsed.version !== 1
      || !['pending', 'syncing', 'failed', 'conflict'].includes(String(parsed.state))
      || !Number.isInteger(parsed.attempts)
      || Number(parsed.attempts) < 0
      || typeof parsed.createdAt !== 'number'
      || typeof parsed.updatedAt !== 'number') return null;
    const owner = parseOwner(parsed.owner);
    const input = completeSaleSchema.safeParse(parsed.input);
    const failure = parseFailure(parsed.failure);
    if (!owner || !input.success || (parsed.failure !== null && !failure)) return null;
    const recoveryDraft = parsed.recoveryDraft === undefined
      ? undefined
      : parseStoredSaleDraft(parsed.recoveryDraft) ?? undefined;
    return {
      version: 1,
      owner,
      input: input.data,
      state: parsed.state as OfflineSaleState,
      attempts: Number(parsed.attempts),
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      failure,
      ...(recoveryDraft === undefined ? {} : { recoveryDraft }),
    };
  } catch {
    return null;
  }
};

const sameOwner = (left: OfflineSaleOwner, right: OfflineSaleOwner) => (
  left.accountId === right.accountId
  && left.role === right.role
  && left.branchId === right.branchId
  && left.cashierSessionId === right.cashierSessionId
);

const writeItem = (item: OfflineSaleQueueItem) => {
  try {
    localStorage.setItem(offlineSaleQueueStorageKey(item.input.idempotencyKey), JSON.stringify(item));
    notifyQueueChange();
    return item;
  } catch {
    return null;
  }
};

const readItem = (idempotencyKey: string) => parseQueueItem(
  localStorage.getItem(offlineSaleQueueStorageKey(idempotencyKey)),
);

export const offlineSaleQueueStorageKey = (idempotencyKey: string) => (
  `${QUEUE_PREFIX}${idempotencyKey}`
);

export const enqueueOfflineSale = ({
  owner,
  input,
  recoveryDraft,
  replacesIdempotencyKey,
}: {
  owner: OfflineSaleOwner;
  input: CompleteSaleInput;
  recoveryDraft?: SaleDraft | StoredSaleDraft;
  replacesIdempotencyKey?: string;
}): OfflineSaleQueueItem | null => {
  const parsedOwner = parseOwner(owner);
  const parsedInput = completeSaleSchema.safeParse(input);
  if (!parsedOwner || !parsedInput.success) return null;
  try {
    const existing = readItem(parsedInput.data.idempotencyKey);
    if (existing) {
      return sameOwner(existing.owner, parsedOwner)
        && JSON.stringify(existing.input) === JSON.stringify(parsedInput.data)
        ? existing
        : null;
    }
    const now = Math.max(
      Date.now(),
      ...listOfflineSales().map((item) => item.createdAt + 1),
    );
    const sanitizedRecoveryDraft = recoveryDraft === undefined
      ? undefined
      : sanitizeSaleDraft(recoveryDraft);
    if (sanitizedRecoveryDraft?.employee) {
      sanitizedRecoveryDraft.employee = {
        ...sanitizedRecoveryDraft.employee,
        fullName: `موظف #${sanitizedRecoveryDraft.employee.employeeCode}`,
      };
    }
    const stored = writeItem({
      version: 1,
      owner: parsedOwner,
      input: parsedInput.data,
      state: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      failure: null,
      ...(sanitizedRecoveryDraft === undefined ? {} : { recoveryDraft: sanitizedRecoveryDraft }),
    });
    if (stored && replacesIdempotencyKey
      && replacesIdempotencyKey !== stored.input.idempotencyKey) {
      removeOfflineSale(replacesIdempotencyKey);
    }
    return stored;
  } catch {
    return null;
  }
};

export const listOfflineSales = (owner?: OfflineSaleOwner): OfflineSaleQueueItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key?.startsWith(QUEUE_PREFIX) === true)
      .flatMap((key) => {
        const item = parseQueueItem(localStorage.getItem(key));
        if (!item) return [];
        if (key !== offlineSaleQueueStorageKey(item.input.idempotencyKey)) return [];
        return owner && !sameOwner(item.owner, owner) ? [] : [item];
      })
      .sort((left, right) => left.createdAt - right.createdAt
        || left.input.idempotencyKey.localeCompare(right.input.idempotencyKey));
  } catch {
    return [];
  }
};

export const markOfflineSaleSyncing = (idempotencyKey: string) => {
  try {
    const current = readItem(idempotencyKey);
    if (!current) return null;
    return writeItem({
      ...current,
      state: 'syncing',
      attempts: current.attempts + 1,
      updatedAt: Date.now(),
      failure: null,
    });
  } catch {
    return null;
  }
};

export const classifySaleSubmissionError = (error: unknown): OfflineSaleFailureKind => {
  if (!(error instanceof ApiError)) return 'retryable';
  return error.status === 0
    || error.status === 401
    || error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500
    ? 'retryable'
    : 'conflict';
};

export const markOfflineSaleFailed = (idempotencyKey: string, error: unknown) => {
  try {
    const current = readItem(idempotencyKey);
    if (!current) return null;
    const kind = classifySaleSubmissionError(error);
    const code = error instanceof ApiError ? error.code : 'NETWORK_ERROR';
    const message = error instanceof Error ? error.message : 'تعذر إرسال البيع';
    return writeItem({
      ...current,
      state: kind === 'conflict' ? 'conflict' : 'failed',
      updatedAt: Date.now(),
      failure: { kind, code, message },
    });
  } catch {
    return null;
  }
};

export const recoverInterruptedOfflineSales = (owner?: OfflineSaleOwner) => {
  for (const item of listOfflineSales(owner)) {
    if (item.state === 'syncing') {
      writeItem({ ...item, state: 'pending', updatedAt: Date.now() });
    }
  }
};

export const removeOfflineSale = (idempotencyKey: string) => {
  try {
    const key = offlineSaleQueueStorageKey(idempotencyKey);
    if (localStorage.getItem(key) === null) return false;
    localStorage.removeItem(key);
    const removed = localStorage.getItem(key) === null;
    if (removed) notifyQueueChange();
    return removed;
  } catch {
    return false;
  }
};

export const subscribeOfflineSaleQueue = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null
      || event.key === LEGACY_KEY
      || event.key.startsWith(LEGACY_PREFIX)
      || event.key.startsWith(QUEUE_PREFIX)) listener();
  };
  window.addEventListener(QUEUE_CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(QUEUE_CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
};

const parseLegacy = (value: string | null) => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const owner = parseOwner(parsed.owner);
    const input = completeSaleSchema.safeParse(parsed.input);
    return owner && input.success ? { owner, input: input.data } : null;
  } catch {
    return null;
  }
};

export const migrateLegacyPendingSales = () => {
  if (typeof window === 'undefined') return;
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key === LEGACY_KEY || key?.startsWith(LEGACY_PREFIX) === true);
    for (const key of keys) {
      const legacy = parseLegacy(localStorage.getItem(key));
      if (legacy && enqueueOfflineSale(legacy)) localStorage.removeItem(key);
    }
  } catch {
    // Keep every legacy record when migration cannot be completed durably.
  }
};

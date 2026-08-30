import type { CompleteSaleInput } from '@capella/contracts';

import {
  listOfflineSales,
  migrateLegacyPendingSales,
  removeOfflineSale,
} from '../offline-sale-queue';
import type { PendingSale } from './sale-primitives';

export const PENDING_KEY = 'capella:pending-sale';
export const PENDING_KEY_PREFIX = `${PENDING_KEY}:`;
export const OFFLINE_QUEUE_PREFIX = 'capella:offline-sale:v1:';

export const readPending = (matches: (pending: PendingSale) => boolean = () => true): PendingSale | null => {
  if (typeof window === 'undefined') return null;
  try {
    migrateLegacyPendingSales();
    return listOfflineSales()
      .map(({ owner, input }) => ({ owner, input }))
      .find(matches) ?? null;
  } catch {
    return null;
  }
};

export const removePendingRequest = (input: CompleteSaleInput) => {
  removeOfflineSale(input.idempotencyKey);
};

'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { invalidateErpCaches } from '@/lib/erp-cache';

import { completeSale } from '../api/sales-api';
import {
  listOfflineSales,
  offlineSaleRetryDelayMs,
  subscribeOfflineSaleQueue,
  type OfflineSaleQueueItem,
} from '../offline-sale-queue';
import { synchronizeOfflineSales } from '../offline-sale-sync';
import {
  OFFLINE_QUEUE_PREFIX,
  PENDING_KEY,
  PENDING_KEY_PREFIX,
  readPending,
} from './pending-sale-storage';
import {
  type PendingSale,
  type PendingSaleOwner,
} from './sale-primitives';

/**
 * Drains the offline sale queue for this workspace and for any older shift of the
 * same account, and reports the pending sale that matches the active draft.
 */
export function useOfflineSaleSync({
  draftHydrated,
  workspaceOwner,
  matchesActiveDraft,
  setPendingSale,
  setBackgroundSyncCount,
}: {
  draftHydrated: boolean;
  workspaceOwner: PendingSaleOwner;
  matchesActiveDraft: (pending: PendingSale) => boolean;
  setPendingSale: (pending: PendingSale | null) => void;
  setBackgroundSyncCount: (update: (current: number) => number) => void;
}) {
  const queryClient = useQueryClient();
  const backgroundSyncedKeys = useRef(new Set<string>());
  const retryTimers = useRef(new Map<string, number>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const timers = retryTimers.current;
    return () => {
      mounted.current = false;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    const recordBackgroundSync = (result: Awaited<ReturnType<typeof synchronizeOfflineSales>>) => {
      if (!mounted.current) return;
      const newKeys = result.confirmed
        .map(({ idempotencyKey: key }) => key)
        .filter((key) => !backgroundSyncedKeys.current.has(key));
      if (newKeys.length === 0) return;
      newKeys.forEach((key) => backgroundSyncedKeys.current.add(key));
      setBackgroundSyncCount((current) => current + newKeys.length);
      void invalidateErpCaches(queryClient, 'sale');
    };
    const synchronizeOwner = (owner: PendingSaleOwner, includeFailed: boolean, delay = 0) => {
      const ownerKey = [
        owner.role,
        owner.accountId ?? 'admin',
        owner.branchId,
        owner.cashierSessionId,
      ].join(':');
      const run = () => {
        if (!mounted.current || !navigator.onLine) return;
        void synchronizeOfflineSales({ owner, submit: completeSale, includeFailed })
          .then(recordBackgroundSync)
          .catch(() => undefined);
      };
      if (delay === 0) run();
      else {
        const existingTimer = retryTimers.current.get(ownerKey);
        if (existingTimer !== undefined) window.clearTimeout(existingTimer);
        const timer = window.setTimeout(() => {
          if (retryTimers.current.get(ownerKey) !== timer) return;
          retryTimers.current.delete(ownerKey);
          run();
        }, delay);
        retryTimers.current.set(ownerKey, timer);
      }
    };
    const synchronizePending = (event?: StorageEvent, retryFailed = false) => {
      if (!event || event.key === PENDING_KEY || event.key?.startsWith(PENDING_KEY_PREFIX)
        || event.key?.startsWith(OFFLINE_QUEUE_PREFIX)) {
        const matching = readPending(matchesActiveDraft);
        setPendingSale(matching);
        const allItems = listOfflineSales();
        const currentItems = allItems.filter((item) => (
          item.owner.accountId === workspaceOwner.accountId
          && item.owner.role === workspaceOwner.role
          && item.owner.branchId === workspaceOwner.branchId
          && item.owner.cashierSessionId === workspaceOwner.cashierSessionId
        ));
        if (!matching && navigator.onLine && currentItems.some((item) => item.state === 'pending')) {
          synchronizeOwner(workspaceOwner, false);
        }
        if (!matching && navigator.onLine && retryFailed) {
          const failed = currentItems.find((item) => item.state === 'failed');
          if (failed) synchronizeOwner(workspaceOwner, true, offlineSaleRetryDelayMs(failed.attempts));
        }
        if (navigator.onLine) {
          const olderOwners = new Map<string, { owner: PendingSaleOwner; items: OfflineSaleQueueItem[] }>();
          for (const item of allItems) {
            if (item.owner.role !== workspaceOwner.role
              || item.owner.accountId !== workspaceOwner.accountId
              || item.owner.cashierSessionId === workspaceOwner.cashierSessionId
              || item.state === 'conflict'
              || (!retryFailed && item.state !== 'pending')) continue;
            const key = [
              item.owner.role,
              item.owner.accountId ?? 'admin',
              item.owner.branchId,
              item.owner.cashierSessionId,
            ].join(':');
            const group = olderOwners.get(key) ?? { owner: item.owner, items: [] };
            group.items.push(item);
            olderOwners.set(key, group);
          }
          for (const { owner, items } of olderOwners.values()) {
            if (items.some((item) => item.state === 'pending')) synchronizeOwner(owner, false);
            if (retryFailed) {
              const failed = items.find((item) => item.state === 'failed');
              if (failed) synchronizeOwner(owner, true, offlineSaleRetryDelayMs(failed.attempts));
            }
          }
        }
      }
    };
    synchronizePending();
    const unsubscribe = subscribeOfflineSaleQueue(() => synchronizePending());
    const onOnline = () => synchronizePending(undefined, true);
    window.addEventListener('storage', synchronizePending);
    window.addEventListener('online', onOnline);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', synchronizePending);
      window.removeEventListener('online', onOnline);
    };
  }, [
    draftHydrated,
    matchesActiveDraft,
    queryClient,
    setBackgroundSyncCount,
    setPendingSale,
    workspaceOwner,
  ]);
}

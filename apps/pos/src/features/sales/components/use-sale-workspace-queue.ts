'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  getOfflineSaleQueueVersion,
  hasUnrecoverableOfflineSales,
  listOfflineSales,
  subscribeOfflineSaleQueue,
} from '../offline-sale-queue';
import {
  type PendingSale,
  type PendingSaleOwner,
} from './sale-primitives';

export function useSaleWorkspaceQueue({
  workspaceOwner,
  hasDraftProgress,
  pendingSale,
}: {
  workspaceOwner: PendingSaleOwner;
  hasDraftProgress: boolean;
  pendingSale: PendingSale | null;
}) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const queueVersion = useSyncExternalStore(
    subscribeOfflineSaleQueue,
    getOfflineSaleQueueVersion,
    getOfflineSaleQueueVersion,
  );
  const offlineQueueSnapshot = useMemo(() => ({
    version: queueVersion,
    items: listOfflineSales(),
    hasUnrecoverable: hasUnrecoverableOfflineSales(),
  }), [queueVersion]);
  const offlineQueue = offlineQueueSnapshot.items;
  const workspaceQueue = useMemo(() => offlineQueue.filter((item) => (
    item.owner.accountId === workspaceOwner.accountId
    && item.owner.role === workspaceOwner.role
    && item.owner.branchId === workspaceOwner.branchId
    && item.owner.cashierSessionId === workspaceOwner.cashierSessionId
  )), [offlineQueue, workspaceOwner]);
  const queuedItem = workspaceQueue.find((item) => item.state === 'failed') ?? workspaceQueue.find(
    (item) => item.input.idempotencyKey === pendingSale?.input.idempotencyKey,
  );
  const crossSessionConflict = !hasDraftProgress ? offlineQueue.find((item) => (
    item.state === 'conflict'
    && item.recoveryDraft !== undefined
    && item.owner.role === workspaceOwner.role
    && item.owner.accountId === workspaceOwner.accountId
    && item.owner.branchId === workspaceOwner.branchId
    && item.owner.cashierSessionId !== workspaceOwner.cashierSessionId
  )) : undefined;
  const displayedQueueItem = queuedItem ?? crossSessionConflict;

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return { online, offlineQueueSnapshot, displayedQueueItem };
}

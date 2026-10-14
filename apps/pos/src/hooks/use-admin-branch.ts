'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

import { useSession } from '@/features/auth';

/** Single key every POS page shares so the admin branch follows across pages. */
export const ADMIN_BRANCH_STORAGE_KEY = 'capella:pos-admin-branch';

export function readStoredBranchId(): number | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  const parsed = Number(sessionStorage.getItem(ADMIN_BRANCH_STORAGE_KEY));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const readServerBranchId = () => undefined;

function writeStoredBranchId(branchId: number | undefined) {
  if (branchId === undefined) sessionStorage.removeItem(ADMIN_BRANCH_STORAGE_KEY);
  else sessionStorage.setItem(ADMIN_BRANCH_STORAGE_KEY, String(branchId));
  for (const listener of listeners) listener();
}

/**
 * Branch state shared by all POS pages. For an admin, the stored value is the single source
 * of truth: every mounted view reads it and is told when it changes.
 *
 * The value itself is role-independent (route deep-links like `?branchId=` and the ERP reports
 * filter apply for any role); role-gating lives at each call site (`isAdmin ? branchId : undefined`,
 * query `enabled` flags). A cashier reads the stored value but changes stay local to the view and
 * are never persisted.
 */
export function useAdminBranch() {
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const shared = useSyncExternalStore(subscribe, readStoredBranchId, readServerBranchId);
  const [local, setLocal] = useState<{ branchId: number | undefined } | null>(null);

  const setBranchId = useCallback((next: number | undefined) => {
    if (isAdmin) writeStoredBranchId(next);
    else setLocal({ branchId: next });
  }, [isAdmin]);

  const branchId = !isAdmin && local ? local.branchId : shared;
  return { branchId, setBranchId, isAdmin };
}

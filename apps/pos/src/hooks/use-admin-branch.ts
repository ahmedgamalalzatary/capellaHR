'use client';

import { useEffect, useState } from 'react';

import { useSession } from '@/features/auth';

/** Single key every POS page shares so the admin branch follows across pages. */
export const ADMIN_BRANCH_STORAGE_KEY = 'capella:pos-admin-branch';

export function readStoredBranchId(): number | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  const parsed = Number(sessionStorage.getItem(ADMIN_BRANCH_STORAGE_KEY));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Branch state shared by all POS pages. Same implementation every page uses:
 * initialize synchronously from storage (no loading flash), persist every
 * change when admin, never touch storage for cashiers.
 *
 * The value itself is role-independent (route deep-links like `?branchId=`
 * and the ERP reports filter apply for any role); role-gating lives at each
 * call site (`isAdmin ? branchId : undefined`, query `enabled` flags), exactly
 * like the per-page code this hook replaced.
 */
export function useAdminBranch() {
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const [branchId, setBranchId] = useState<number | undefined>(() => readStoredBranchId());

  useEffect(() => {
    if (!isAdmin) return;
    if (branchId === undefined) sessionStorage.removeItem(ADMIN_BRANCH_STORAGE_KEY);
    else sessionStorage.setItem(ADMIN_BRANCH_STORAGE_KEY, String(branchId));
  }, [branchId, isAdmin]);

  return { branchId, setBranchId, isAdmin };
}

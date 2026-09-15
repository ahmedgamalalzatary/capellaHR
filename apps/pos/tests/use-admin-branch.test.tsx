import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ADMIN_BRANCH_STORAGE_KEY, useAdminBranch } from '../src/hooks/use-admin-branch';

const sessionState = vi.hoisted(() => ({ actor: { type: 'admin' } as { type: string } }));
const SRC_DIR = join(__dirname, '..', 'src');
const HOOK_FILE = ['hooks', 'use-admin-branch.ts'].join('/');

vi.mock('@/features/auth', () => ({
  useSession: () => ({ isSuccess: true, data: { actor: sessionState.actor } }),
}));

function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTs(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

beforeEach(() => {
  sessionState.actor = { type: 'admin' };
  sessionStorage.clear();
});

describe('useAdminBranch', () => {
  test('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useAdminBranch());
    expect(result.current.branchId).toBeUndefined();
  });

  test('initializes synchronously from storage like every POS page (no effect flash)', () => {
    sessionStorage.setItem(ADMIN_BRANCH_STORAGE_KEY, '7');
    const { result } = renderHook(() => useAdminBranch());
    expect(result.current.branchId).toBe(7);
  });

  test('persists every change so the next page reuses it', () => {
    const { result } = renderHook(() => useAdminBranch());
    act(() => result.current.setBranchId(4));
    expect(result.current.branchId).toBe(4);
    expect(sessionStorage.getItem(ADMIN_BRANCH_STORAGE_KEY)).toBe('4');
  });

  test('clearing the branch removes the stored key', () => {
    sessionStorage.setItem(ADMIN_BRANCH_STORAGE_KEY, '4');
    const { result } = renderHook(() => useAdminBranch());
    act(() => result.current.setBranchId(undefined));
    expect(sessionStorage.getItem(ADMIN_BRANCH_STORAGE_KEY)).toBeNull();
  });

  test('ignores garbage in storage', () => {
    sessionStorage.setItem(ADMIN_BRANCH_STORAGE_KEY, 'abc');
    const { result } = renderHook(() => useAdminBranch());
    expect(result.current.branchId).toBeUndefined();
  });

  test('cashier reads the shared value but never persists (callers gate via isAdmin)', () => {
    sessionState.actor = { type: 'cashier' };
    sessionStorage.setItem(ADMIN_BRANCH_STORAGE_KEY, '7');
    const { result } = renderHook(() => useAdminBranch());
    expect(result.current.branchId).toBe(7);
    expect(result.current.isAdmin).toBe(false);
    act(() => result.current.setBranchId(4));
    expect(sessionStorage.getItem(ADMIN_BRANCH_STORAGE_KEY)).toBe('7');
  });

  test('keeps direct access to the storage key inside the shared hook', () => {
    const offenders = collectTs(SRC_DIR)
      .filter((full) => full.substring(SRC_DIR.length + 1).replace(/\\/g, '/') !== HOOK_FILE)
      .map((full) => ({
        rel: full.substring(SRC_DIR.length + 1).replace(/\\/g, '/'),
        text: readFileSync(full, 'utf-8'),
      }))
      .filter(({ text }) => text.includes('capella:pos-admin-branch'))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});

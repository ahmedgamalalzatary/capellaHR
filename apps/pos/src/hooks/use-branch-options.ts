'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

export interface BranchOption { id: number; name: string }

export const branchOptionsQueryKey = ['branch-options'] as const;

/**
 * Every branch (all pages), for admin pickers: the top-bar switcher and `BranchSelect`.
 * One query key, so all pickers share one request and one cached list.
 */
export function useBranchOptions({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: branchOptionsQueryKey,
    queryFn: () => fetchAllPages((page) => api.getPage<BranchOption>(`/branches?page=${page}&pageSize=100`)),
    enabled,
    staleTime: 5 * 60_000,
  });
  const options = (query.data ?? []).map((branch) => ({ value: String(branch.id), label: branch.name }));
  return { query, options };
}

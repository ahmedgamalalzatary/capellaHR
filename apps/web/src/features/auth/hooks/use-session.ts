'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/client';

import { getSession, logout } from '../api/auth-api';

// A single exported identity keeps login, logout, and route guards on the same cache entry.
export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

export function clearSessionState(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
  if (typeof window !== 'undefined') {
    const protectedKeys = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.key(index),
    ).filter((key): key is string => key?.startsWith('capella:protected-area:') === true);
    protectedKeys.forEach((key) => window.sessionStorage.removeItem(key));
  }
}

/** Current session actor; null when unauthenticated. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await getSession();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    refetchInterval: (query) => query.state.data?.actor.type === 'employee' ? 5_000 : false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      clearSessionState(queryClient);
    },
  });
}

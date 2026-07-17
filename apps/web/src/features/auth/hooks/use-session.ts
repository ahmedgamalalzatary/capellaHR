'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/client';

import { getSession, logout } from '../api/auth-api';

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

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
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.removeQueries();
    },
  });
}

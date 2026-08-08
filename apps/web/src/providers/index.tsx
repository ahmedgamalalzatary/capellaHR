'use client';

import { useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { SESSION_QUERY_KEY } from '@/features/auth/hooks/use-session';
import { ApiError } from '@/lib/api/client';

import { RuntimeConfigProvider } from './runtime-config';

/**
 * The API is the only authority on whether a session is alive, and it answers on every
 * request. A 401 from any endpoint therefore means the session ended, so the cached
 * session entry is dropped and the route guards send the user to /login. Without this a
 * session that dies mid-use leaves a fully rendered admin shell whose every panel shows
 * a load error, with nothing telling the user to sign in again.
 *
 * Deliberately narrow: only 401 clears the session. A 500 or an unreachable server says
 * nothing about whether the session is valid, and signing the user out on a transient
 * blip would be its own bug.
 */
export function createAppQueryClient() {
  const endSessionOnUnauthenticated = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    }
  };
  // Reads and writes both: submitting a form is exactly when a dead session tends to be
  // discovered, and it must sign the user out the same way a failed read does.
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: endSessionOnUnauthenticated }),
    mutationCache: new MutationCache({ onError: endSessionOnUnauthenticated }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  return queryClient;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createAppQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeConfigProvider>{children}</RuntimeConfigProvider>
      <Toaster position="top-center" dir="rtl" richColors closeButton />
    </QueryClientProvider>
  );
}

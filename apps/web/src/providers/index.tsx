'use client';

import { useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { RuntimeConfigProvider } from './runtime-config';
import { clearSessionState } from '@/features/auth';
import { ApiError } from '@/lib/api/client';

export function createAppQueryClient() {
  let queryClient: QueryClient;
  const handleError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      clearSessionState(queryClient);
    }
  };
  queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
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

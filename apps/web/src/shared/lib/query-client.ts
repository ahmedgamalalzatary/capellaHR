import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/shared/lib/api-client";

/**
 * Creates a configured QueryClient. A factory (not a singleton) so the server
 * gets a fresh client per request and the browser keeps one stable instance.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Don't retry auth/permission/not-found responses.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        }
      },
      mutations: {
        retry: false
      }
    }
  });
}

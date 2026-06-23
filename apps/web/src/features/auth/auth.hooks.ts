import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/shared/lib/api-client";
import { authApi } from "@/features/auth/auth.api";
import { authKeys } from "@/features/auth/auth.keys";
import type { Actor } from "@/features/auth/auth.types";

/** Current authenticated actor. Returns `null` (not an error) when signed out. */
export function useCurrentUser() {
  return useQuery<Actor | null>({
    queryKey: authKeys.me(),
    queryFn: async () => {
      try {
        const { actor } = await authApi.me();
        return actor;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    }
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.signIn,
    onSuccess: ({ actor }) => {
      queryClient.setQueryData(authKeys.me(), actor);
    }
  });
}

export function useAdminSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.adminSignIn,
    onSuccess: ({ actor }) => {
      queryClient.setQueryData(authKeys.me(), actor);
    }
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.signOut,
    onSuccess: () => {
      queryClient.setQueryData(authKeys.me(), null);
    }
  });
}

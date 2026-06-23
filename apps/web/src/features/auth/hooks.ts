import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api-client";
import { authApi } from "@/features/auth/api";

export const authKeys = {
  me: ["auth", "me"] as const
};

/** Current authenticated actor. Returns `null` (not an error) when signed out. */
export function useCurrentUser() {
  return useQuery({
    queryKey: authKeys.me,
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
      queryClient.setQueryData(authKeys.me, actor);
    }
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.signOut,
    onSuccess: () => {
      queryClient.setQueryData(authKeys.me, null);
      queryClient.invalidateQueries();
    }
  });
}

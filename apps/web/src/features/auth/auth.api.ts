import type { SignInInput } from "@capella/shared/contracts";

import { api } from "@/shared/lib/api-client";
import type { AdminSignInFormValues } from "@/features/auth/auth.schemas";
import type { AuthResponse } from "@/features/auth/auth.types";

export const authApi = {
  /** Employee sign-in (phone + password). */
  signIn: (input: SignInInput) =>
    api.post<AuthResponse>("/auth/sign-in", { json: input }),

  /** Admin sign-in (email + password). */
  adminSignIn: (input: AdminSignInFormValues) =>
    api.post<AuthResponse>("/auth/admin/sign-in", { json: input }),

  /** Current session actor; throws ApiError(401) when unauthenticated. */
  me: () => api.get<AuthResponse>("/auth/me"),

  signOut: () => api.post<void>("/auth/sign-out")
};

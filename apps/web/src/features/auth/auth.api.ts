import type { SignInInput } from "@capella/shared/contracts";

import { api } from "@/shared/lib/api-client";

/**
 * Actor returned by the API on sign-in and `GET /auth/me`. Mirrors the backend
 * session actor; tighten this type once the shared package exports it.
 */
export type Actor = {
  id: string;
  role: "admin" | "employee";
  name?: string;
  email?: string;
  phone?: string;
};

type AuthResponse = { actor: Actor };

export const authApi = {
  /** Employee sign-in (phone + password). */
  signIn: (input: SignInInput) =>
    api.post<AuthResponse>("/auth/sign-in", { json: input }),

  /** Admin sign-in (email + password). */
  adminSignIn: (input: { email: string; password: string }) =>
    api.post<AuthResponse>("/auth/admin/sign-in", { json: input }),

  /** Current session actor; throws ApiError(401) when unauthenticated. */
  me: () => api.get<AuthResponse>("/auth/me"),

  signOut: () => api.post<void>("/auth/sign-out")
};

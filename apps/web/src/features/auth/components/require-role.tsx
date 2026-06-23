"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useCurrentUser } from "@/features/auth/auth.hooks";
import type { Role } from "@/features/auth/auth.types";

const SIGN_IN_PATH: Record<Role, string> = {
  admin: "/admin/sign-in",
  employee: "/sign-in"
};

const HOME_PATH: Record<Role, string> = {
  admin: "/dashboard",
  employee: "/attendance"
};

/**
 * Client-side role guard used by the (admin) / (employee) route group layouts.
 * - While the session resolves: renders nothing (avoids content flash).
 * - Unauthenticated: redirects to the matching sign-in page.
 * - Wrong role: redirects that actor to their own home.
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const router = useRouter();
  const { data: actor, isPending } = useCurrentUser();

  useEffect(() => {
    if (isPending) return;

    if (!actor) {
      router.replace(SIGN_IN_PATH[role]);
      return;
    }

    if (actor.role !== role) {
      router.replace(HOME_PATH[actor.role]);
    }
  }, [actor, isPending, role, router]);

  if (isPending || !actor || actor.role !== role) {
    return null;
  }

  return <>{children}</>;
}

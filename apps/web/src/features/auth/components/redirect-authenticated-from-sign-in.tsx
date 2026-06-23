"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useCurrentUser } from "@/features/auth/auth.hooks";
import type { Role } from "@/features/auth/auth.types";

const HOME_PATH: Record<Role, string> = {
  admin: "/dashboard",
  employee: "/attendance"
};

export function RedirectAuthenticatedFromSignIn({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: actor, isPending } = useCurrentUser();

  useEffect(() => {
    if (isPending || !actor) {
      return;
    }

    router.replace(HOME_PATH[actor.role]);
  }, [actor, isPending, router]);

  if (isPending || actor) {
    return null;
  }

  return <>{children}</>;
}

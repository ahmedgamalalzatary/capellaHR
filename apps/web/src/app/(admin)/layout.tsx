import type { ReactNode } from "react";

import { AdminShell } from "@/shared/components/layout/admin-shell";
import { RequireRole } from "@/features/auth/components/require-role";

/** Admin route group. Guards the admin role and renders the app shell. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="admin">
      <AdminShell>{children}</AdminShell>
    </RequireRole>
  );
}

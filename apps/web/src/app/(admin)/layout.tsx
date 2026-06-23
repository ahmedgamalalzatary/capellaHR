import type { ReactNode } from "react";

import { RequireRole } from "@/features/auth/components/require-role";

/** Admin route group. Guards the admin role; app shell will be added later. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <RequireRole role="admin">{children}</RequireRole>;
}

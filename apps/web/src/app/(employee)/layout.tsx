import type { ReactNode } from "react";

import { RequireRole } from "@/features/auth/components/require-role";

/** Employee route group. Guards the employee role; shell added later. */
export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return <RequireRole role="employee">{children}</RequireRole>;
}

"use client";

import type { ReactNode } from "react";

import { AdminSidebar } from "@/shared/components/layout/admin-sidebar";
import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";

/** Admin app shell: persistent sidebar around the routed page. */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}

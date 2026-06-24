"use client";

import type { ReactNode } from "react";

import { AdminSidebar } from "@/shared/components/layout/admin-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from "@/shared/components/ui/sidebar";

/** Admin app shell: persistent sidebar around the routed page. */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        {/* Mobile-only top bar: the sidebar collapses off-canvas below `md`,
            so this trigger is the only way to reach navigation on phones. */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background px-4 md:hidden">
          <SidebarTrigger className="-ms-1" />
          <span className="text-lg font-bold">كابيلا</span>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

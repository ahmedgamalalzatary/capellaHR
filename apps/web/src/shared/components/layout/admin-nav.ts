import { Building2, LayoutDashboard, Users, type LucideIcon } from "lucide-react";

/** A single admin sidebar navigation entry. */
export type AdminNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

/**
 * Admin sidebar navigation. Add future admin sections here — the sidebar and
 * its active-link highlighting pick them up automatically.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { title: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard },
  { title: "الفروع", href: "/branches", icon: Building2 },
  { title: "الموظفون", href: "/employees", icon: Users }
];

/** Whether `pathname` belongs to the section rooted at `href`. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

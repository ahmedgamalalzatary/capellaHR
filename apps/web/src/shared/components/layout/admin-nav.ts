import {
  Building2,
  CalendarClock,
  FileText,
  LayoutDashboard,
  LockKeyhole,
  ScrollText,
  Users,
  type LucideIcon
} from "lucide-react";

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
  { title: "الموظفون", href: "/employees", icon: Users },
  { title: "الحضور", href: "/admin/attendance", icon: CalendarClock },
  { title: "التقارير", href: "/admin/reports", icon: FileText },
  { title: "سجل التدقيق", href: "/admin/audit-logs", icon: ScrollText },
  { title: "أقفال الشهور", href: "/admin/month-locks", icon: LockKeyhole }
];

/** Whether `pathname` belongs to the section rooted at `href`. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

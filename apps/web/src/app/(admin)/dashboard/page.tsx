import Link from "next/link";

import { Card } from "@/shared/components/ui/card";
import { ADMIN_NAV_ITEMS } from "@/shared/components/layout/admin-nav";

const QUICK_LINKS = ADMIN_NAV_ITEMS.filter((item) => item.href !== "/dashboard");

export default function DashboardPage() {
  return (
    <main className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">لوحة التحكم</h1>
        <p className="mt-1 text-muted-foreground">مرحبًا بك في نظام كابيلا لإدارة الموارد البشرية.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="flex items-center gap-3 p-5 transition-colors hover:bg-accent">
              <item.icon className="size-6 text-muted-foreground" />
              <span className="font-medium">{item.title}</span>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}

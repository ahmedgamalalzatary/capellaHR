'use client';

import { CalendarDays, Clock3, LogOut, Plus, ReceiptText, ShoppingCart } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import {
  AppShell,
  Board,
  BoardFigure,
  BoardFigures,
  Button,
  PageHeader,
  Select,
  type ShellNavItem,
} from '@capella/ui';

import { adminNavigation, cashierNavigation } from '@/components/shell/nav';

/** D4 proposal (not decided yet): the cashier's four most-used destinations. */
const proposedCashierTabs: ShellNavItem[] = [
  { href: '/', label: 'الوردية', icon: Clock3 },
  { href: '/sales', label: 'بيع جديد', icon: ShoppingCart },
  { href: '/bookings', label: 'المواعيد', icon: CalendarDays },
  { href: '/invoices', label: 'الفواتير', icon: ReceiptText },
];

export function ShellPreview() {
  const pathname = usePathname();
  const [role, setRole] = useState<'admin' | 'cashier'>('cashier');
  const isAdmin = role === 'admin';

  return (
    <AppShell
      product="نقطة البيع"
      logoSrc="/brand/capella-mark.png"
      navigation={isAdmin ? adminNavigation : cashierNavigation}
      pathname={pathname === '/_design/shell' ? '/' : pathname}
      {...(isAdmin ? {} : { bottomTabs: proposedCashierTabs })}
      topbarStart={isAdmin ? (
        <Select aria-label="الفرع الحالي" className="h-(--control-h-sm) max-w-[11rem] sm:max-w-[16rem]" defaultValue="1">
          <option value="">اختر فرعًا</option>
          <option value="1">فرع المعادي</option>
          <option value="2">فرع مدينة نصر</option>
        </Select>
      ) : null}
      topbarEnd={(
        <>
          {isAdmin ? null : (
            <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              <span className="font-medium text-success">الوردية مفتوحة</span>
              <span className="hidden text-muted md:inline">منذ 9:12 ص</span>
            </span>
          )}
          <Button variant="ghost" size="sm" aria-label="تسجيل الخروج">
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">تسجيل الخروج</span>
          </Button>
        </>
      )}
      sidebarFooter={<p className="rounded-control bg-flap px-2.5 py-2">{isAdmin ? 'حساب المدير' : 'حساب كاشير'}</p>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-muted">معاينة بدور:</span>
          <button type="button" aria-pressed={!isAdmin} onClick={() => setRole('cashier')} className="underline aria-pressed:font-semibold">كاشير</button>
          <button type="button" aria-pressed={isAdmin} onClick={() => setRole('admin')} className="underline aria-pressed:font-semibold">مدير</button>
        </div>
        <PageHeader
          title="الوردية"
          description="معاينة فقط — الروابط تفتح صفحات التطبيق الحالية."
          primaryAction={<Button><Plus className="size-4" aria-hidden />بيع جديد</Button>}
        />
        <Board title="الوردية الآن">
          <BoardFigures>
            <BoardFigure label="المتبقي في الدرج" value="4,250.00" hint="ج.م" />
            <BoardFigure label="مبيعات اليوم" value="7,820.00" hint="ج.م" />
            <BoardFigure label="مدة الوردية" value="4:18" />
            <BoardFigure label="مواعيد متأخرة" value="1" tone="late" />
          </BoardFigures>
        </Board>
        <div className="h-[120vh] rounded-card border border-dashed border-line p-4 text-sm text-muted">
          مساحة للتمرير: الزر الأساسي يبقى ظاهرًا أسفل الشاشة على الهاتف.
        </div>
      </div>
    </AppShell>
  );
}

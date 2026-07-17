import {
  LayoutDashboard,
  Users,
  Smartphone,
  Clock,
  CalendarOff,
  CalendarCheck,
  Wallet,
  Gift,
  MinusCircle,
  HandCoins,
  Building2,
  FileText,
  ScrollText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'الرئيسية', icon: LayoutDashboard }],
  },
  {
    label: 'الأشخاص',
    items: [
      { href: '/employees', label: 'الموظفون', icon: Users },
      { href: '/devices', label: 'الأجهزة', icon: Smartphone },
    ],
  },
  {
    label: 'الوقت',
    items: [
      { href: '/shifts', label: 'الورديات', icon: Clock },
      { href: '/weekly-day-off', label: 'الإجازة الأسبوعية', icon: CalendarOff },
      { href: '/attendance', label: 'الحضور والغياب', icon: CalendarCheck },
    ],
  },
  {
    label: 'المال',
    items: [
      { href: '/payroll', label: 'الرواتب', icon: Wallet },
      { href: '/bonuses', label: 'المكافآت', icon: Gift },
      { href: '/deductions', label: 'الخصومات', icon: MinusCircle },
      { href: '/advances', label: 'السلف', icon: HandCoins },
    ],
  },
  {
    label: 'النظام',
    items: [
      { href: '/branches', label: 'الفروع', icon: Building2 },
      { href: '/reports', label: 'التقارير', icon: FileText },
      { href: '/audit', label: 'سجل المراجعة', icon: ScrollText },
      { href: '/settings', label: 'الإعدادات', icon: Settings },
    ],
  },
];

import {
  Clock3,
  FileText,
  LayoutDashboard,
  LayoutList,
  Package,
  Percent,
  ReceiptText,
  RotateCcw,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Frontend route metadata: labels and icons are presentation, not backend domain data. */
export const adminNavigation: NavGroup[] = [
  {
    label: 'المبيعات والعملاء',
    items: [
      { href: '/', label: 'لوحة الإدارة', icon: LayoutDashboard },
      { href: '/sales', label: 'بيع جديد', icon: ShoppingCart },
      { href: '/invoices', label: 'الفواتير', icon: ReceiptText },
      { href: '/refunds', label: 'المرتجعات', icon: RotateCcw },
      { href: '/clients', label: 'العملاء', icon: Users },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { href: '/cashier-sessions', label: 'ورديات الكاشير', icon: Clock3 },
      { href: '/catalog', label: 'الكتالوج', icon: LayoutList },
      { href: '/products', label: 'المنتجات والمخزون', icon: Package },
      { href: '/suppliers', label: 'الموردون والمشتريات', icon: Truck },
      { href: '/expenses', label: 'المصروفات', icon: Wallet },
    ],
  },
  {
    label: 'المتابعة',
    items: [
      { href: '/commissions', label: 'العمولات', icon: Percent },
      { href: '/reports', label: 'التقارير', icon: FileText },
    ],
  },
  {
    label: 'النظام',
    items: [{ href: '/cashier-accounts', label: 'حسابات الكاشير', icon: UserCog }],
  },
];

/**
 * The Cashier runs the same branch operations an Admin does. Only oversight of
 * other cashiers (shifts, accounts) and the money-analysis screens (commissions,
 * reports) stay with the Admin.
 */
export const cashierNavigation: NavGroup[] = [
  {
    label: 'نقطة البيع',
    items: [
      { href: '/', label: 'الوردية', icon: Clock3 },
      { href: '/sales', label: 'بيع جديد', icon: ShoppingCart },
      { href: '/invoices', label: 'الفواتير', icon: ReceiptText },
      { href: '/refunds', label: 'المرتجعات', icon: RotateCcw },
      { href: '/clients', label: 'العملاء', icon: Users },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { href: '/catalog', label: 'الكتالوج', icon: LayoutList },
      { href: '/products', label: 'المنتجات والمخزون', icon: Package },
      { href: '/suppliers', label: 'الموردون والمشتريات', icon: Truck },
      { href: '/expenses', label: 'المصروفات', icon: Wallet },
    ],
  },
];

/** The root destination must not stay highlighted on every nested route. */
export const isActiveNavItem = (href: string, pathname: string) => (
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
);

import type { Metadata } from 'next';

import { SuppliersPurchasesView } from '@/features/suppliers';

export const metadata: Metadata = { title: 'الموردون والمشتريات' };

export default function SuppliersPage() { return <SuppliersPurchasesView />; }

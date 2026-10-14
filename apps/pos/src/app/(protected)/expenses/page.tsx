import type { Metadata } from 'next';

import { ExpensesView } from '@/features/expenses';
import { RequireErpAccount } from '@/features/auth';

export const metadata: Metadata = { title: 'المصروفات' };


export default function ExpensesPage() { return <RequireErpAccount><ExpensesView /></RequireErpAccount>; }

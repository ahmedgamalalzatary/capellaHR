import { ExpensesView } from '@/features/expenses';
import { RequireErpAccount } from '@/features/auth';

export default function ExpensesPage() { return <RequireErpAccount role="admin"><ExpensesView /></RequireErpAccount>; }

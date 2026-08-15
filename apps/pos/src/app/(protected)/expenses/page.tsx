import { ExpensesView } from '@/features/expenses';
import { RequireErpAccount } from '@/features/auth';

export default function ExpensesPage() { return <RequireErpAccount><ExpensesView /></RequireErpAccount>; }

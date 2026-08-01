'use client';

import { cn } from '@capella/ui';
import { useState } from 'react';

import { AdminLoginForm } from './admin-login-form';
import { CashierLoginForm } from './cashier-login-form';

type LoginRole = 'cashier' | 'admin';

const tabs: { role: LoginRole; label: string }[] = [
  { role: 'cashier', label: 'كاشير' },
  { role: 'admin', label: 'مدير' },
];

export function LoginView() {
  const [role, setRole] = useState<LoginRole>('cashier');

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-bold text-ink">كابيلا — نقطة البيع</h1>

      <div role="tablist" aria-label="نوع الحساب" className="inline-flex rounded-control border border-line p-1">
        {tabs.map((tab) => (
          <button
            key={tab.role}
            type="button"
            role="tab"
            aria-selected={role === tab.role}
            onClick={() => setRole(tab.role)}
            className={cn(
              'rounded-control px-4 py-1.5 text-sm font-medium transition-colors',
              role === tab.role ? 'bg-ink text-paper' : 'text-ink hover:bg-ink/5',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {role === 'cashier' ? <CashierLoginForm /> : <AdminLoginForm />}
    </div>
  );
}

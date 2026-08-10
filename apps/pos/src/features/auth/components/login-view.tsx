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
    <div className="flex min-h-dvh items-center justify-center bg-surface p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-ink">كابيلا</h1>
          <p className="mt-1 text-sm text-muted">نقطة البيع</p>
        </div>

        <div
          role="group"
          aria-label="نوع الحساب"
          className="grid grid-cols-2 gap-1 rounded-control border border-line bg-paper p-1"
        >
          {tabs.map((tab) => (
            <button
              key={tab.role}
              type="button"
              aria-pressed={role === tab.role}
              onClick={() => setRole(tab.role)}
              className={cn(
                'rounded-control px-4 py-2 text-sm font-medium transition-colors',
                role === tab.role ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5 hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {role === 'cashier' ? <CashierLoginForm /> : <AdminLoginForm />}

        <p className="text-center text-[12px] text-muted">
          كل عملية بيع مسجّلة باسم الحساب الذي سجّل الدخول.
        </p>
      </div>
    </div>
  );
}

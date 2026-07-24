'use client';

import { useState } from 'react';

import { Button } from '@capella/ui';

import { BaseSalariesSection } from './base-salaries-section';
import { MonthlyPayrollSection } from './monthly-payroll-section';

export function PayrollView() {
  const [section, setSection] = useState<'months' | 'base'>('months');

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="أقسام الرواتب">
        <Button
          role="tab"
          aria-selected={section === 'months'}
          variant={section === 'months' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setSection('months')}
        >
          رواتب الشهور
        </Button>
        <Button
          role="tab"
          aria-selected={section === 'base'}
          variant={section === 'base' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setSection('base')}
        >
          الرواتب الأساسية
        </Button>
      </div>
      {section === 'months' ? <MonthlyPayrollSection /> : <BaseSalariesSection />}
    </div>
  );
}

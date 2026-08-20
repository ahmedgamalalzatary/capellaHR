'use client';

import { Card, CardContent } from '@capella/ui';

import type { CashierSessionSummary } from '../api/cashier-sessions-api';

const methodLabels = {
  cash: 'نقدي',
  visa: 'فيزا',
  instapay: 'إنستاباي',
  vodafone_cash: 'محفظة',
} as const;

const methods = ['cash', 'visa', 'instapay', 'vodafone_cash'] as const;

/** `8 س 30 د`, which reads at a glance next to a shift that is still running. */
export const formatShiftDuration = (minutes: number) => (
  `${Math.floor(minutes / 60)} س ${minutes % 60} د`
);

export const formatShiftMoney = (value: string) => `${value} ج.م`;

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-control border border-line bg-surface/60 px-3 py-2.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={`mt-1 tabular text-sm font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The money a shift moved, in both directions and per method. Refunds are shown
 * beside takings rather than netted into them: a till can hand money back on a
 * method it never took in, and that is exactly what an owner needs to see.
 */
export function ShiftMoney({ summary }: { summary: CashierSessionSummary }) {
  return (
    <section aria-label="حركة الوردية" className="space-y-3">
      <dl className="grid gap-2 sm:grid-cols-4">
        <Figure label="عدد المبيعات" value={String(summary.saleCount)} />
        <Figure label="المحصّل" value={formatShiftMoney(summary.takenTotal)} />
        <Figure
          label="المسترد"
          value={formatShiftMoney(summary.refundedTotal)}
          {...(summary.refundedTotal === '0.00' ? {} : { tone: 'danger' as const })}
        />
        <Figure label="الصافي" value={formatShiftMoney(summary.net)} />
      </dl>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/70 text-[12px] text-muted">
                <th scope="col" className="px-3 py-2 text-start font-medium">وسيلة الدفع</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">محصّل</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">مسترد</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((method) => (
                <tr key={method} className="border-b border-line/40 last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
                    {methodLabels[method]}
                  </th>
                  <td className="tabular px-3 py-2 text-ink">
                    {formatShiftMoney(summary.taken[method])}
                  </td>
                  <td className="tabular px-3 py-2 text-ink">
                    {formatShiftMoney(summary.refunded[method])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

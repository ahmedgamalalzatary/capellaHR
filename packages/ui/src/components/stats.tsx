'use client';

import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { BoardFigure, type BoardFigureProps } from './board';

/**
 * The board strip at the top of a list page: its key figures on espresso cells, each linking to
 * the rows behind it. Two per row on phones, up to four on wide screens.
 */
export function StatGrid({ label, children, className }: {
  /** Accessible name, e.g. "ملخص الفواتير". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={label} className={cn('rounded-card bg-board p-2', className)}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

/** One figure in a StatGrid (a BoardFigure). */
export function StatTile(props: BoardFigureProps) {
  return <BoardFigure {...props} />;
}

export interface TotalItem {
  label: string;
  /** Already formatted, e.g. <Money value={…} />. */
  value: ReactNode;
  /** Emphasise the one total that matters most (e.g. remaining). */
  strong?: boolean;
}

/**
 * Sums for the current filter, under the list. Says which rows it covers, so a total never reads
 * as the whole ledger when a filter is on.
 */
export function TotalsBar({ items, scope, className }: {
  items: readonly TotalItem[];
  /** e.g. "إجمالي 130 فاتورة مطابقة". */
  scope: string;
  className?: string;
}) {
  return (
    <section
      aria-label="الإجماليات"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-card border border-line bg-paper px-4 py-3',
        className,
      )}
    >
      <p className="text-[13px] text-muted">{scope}</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[11px] text-muted">{item.label}</dt>
            <dd className={cn('tabular text-ink', item.strong ? 'text-lg font-bold text-brand-strong' : 'text-base font-semibold')}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

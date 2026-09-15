'use client';

import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { getNextSort, type SortState } from '../lib/sort';

export interface SortableTHProps {
  label: ReactNode;
  sortKey: string;
  sort: SortState | null;
  onSort: (next: SortState | null) => void;
  className?: string;
}

/**
 * Table header cell with sort control. Renders a plain `<th>` so it works in
 * any table; announce state via `aria-sort` on the cell.
 */
export function SortableTH({ label, sortKey, sort, onSort, className }: SortableTHProps) {
  const active = sort?.key === sortKey;
  return (
    <th
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-3 py-2 text-start text-[13px] font-medium text-muted', className)}
    >
      <button
        type="button"
        onClick={() => onSort(getNextSort(sort, sortKey))}
        aria-label={typeof label === 'string' ? `ترتيب حسب ${label}` : 'تبديل الترتيب'}
        className="inline-flex items-center gap-1 hover:text-ink"
      >
        {label}
        <span aria-hidden className="text-[11px]">
          {active ? (sort.direction === 'asc' ? '▲' : '▼') : '△'}
        </span>
      </button>
    </th>
  );
}

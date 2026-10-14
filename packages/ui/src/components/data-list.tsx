'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { useMatchMedia, WIDE_QUERY } from '../hooks/use-match-media';
import { cn } from '../lib/cn';
import { getNextSort, type SortState } from '../lib/sort';
import { SkeletonRows, LoadingState } from './loading';
import { LoadError } from './notice';

/**
 * Where a column goes when a row becomes a card on a phone:
 * - primary: the card's title (one per list)
 * - secondary: a muted line under the title
 * - status: top end corner, beside the title
 * - amount: large figure at the bottom end
 * - meta: small "label: value" pairs (the default)
 * - hidden: left out on phones
 */
export type MobileRole = 'primary' | 'secondary' | 'status' | 'amount' | 'meta' | 'hidden';

export interface DataColumn<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  mobile?: MobileRole;
  /** Money, counts, durations: tabular figures. */
  numeric?: boolean;
  /** Server sort key; makes the header a sort button. */
  sortKey?: string;
  /** Totals footer cell for the current filter (table only; phones use TotalsBar). */
  footer?: ReactNode;
  className?: string;
}

export interface DataListProps<Row> {
  /** Accessible name of the table / list, e.g. "الفواتير". */
  label: string;
  rows: readonly Row[];
  columns: readonly DataColumn<Row>[];
  getRowKey: (row: Row) => string;
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  /** Per-row actions (RowActions). Pinned to the end column on wide screens. */
  actions?: (row: Row) => ReactNode;
  /** Marks rows that need attention (late, locked…) with a coloured start edge. */
  rowTone?: (row: Row) => 'late' | 'danger' | 'muted' | undefined;
  loading?: boolean;
  error?: { message: string; onRetry: () => void } | null;
  /** Shown when there are no rows (use ListEmptyState). */
  empty?: ReactNode;
  className?: string;
}

const toneEdge = {
  late: 'border-s-2 border-s-late',
  danger: 'border-s-2 border-s-danger',
  muted: 'opacity-70',
} as const;

function SortHeader<Row>({ column, sort, onSortChange }: {
  column: DataColumn<Row>;
  sort: SortState | null;
  onSortChange: (next: SortState | null) => void;
}) {
  const key = column.sortKey!;
  const active = sort?.key === key;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      aria-label={`ترتيب حسب ${column.header}`}
      onClick={() => onSortChange(getNextSort(sort, key))}
      className={cn('inline-flex items-center gap-1 rounded-cell hover:text-ink', active && 'text-ink')}
    >
      {column.header}
      <Icon className={cn('size-3.5', !active && 'opacity-50')} aria-hidden />
    </button>
  );
}

/**
 * The one list for records. Wide screens get a table (header, numeric alignment, pinned actions,
 * optional totals footer); phones get one card per record laid out by each column's `mobile` role.
 * Only one of the two renders, so every name on the page stays unique.
 */
export function DataList<Row>({
  label,
  rows,
  columns,
  getRowKey,
  sort = null,
  onSortChange,
  actions,
  rowTone,
  loading = false,
  error = null,
  empty,
  className,
}: DataListProps<Row>) {
  const wide = useMatchMedia(WIDE_QUERY, true);

  if (error) return <LoadError message={error.message} onRetry={error.onRetry} {...(className ? { className } : {})} />;
  if (loading && rows.length === 0) {
    return (
      <div className={cn('rounded-card border border-line bg-paper', className)}>
        <LoadingState label={`جارٍ تحميل ${label}`} className="pb-0" />
        <SkeletonRows rows={3} />
      </div>
    );
  }
  if (rows.length === 0) return <div className={cn('rounded-card border border-line bg-paper', className)}>{empty}</div>;

  if (wide) {
    const hasFooter = columns.some((column) => column.footer !== undefined);
    return (
      <div
        aria-busy={loading || undefined}
        className={cn('scroll-thin overflow-x-auto rounded-card border border-line bg-paper shadow-card', loading && 'opacity-70', className)}
      >
        <table aria-label={label} className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-line bg-surface/70">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortKey
                    ? sort?.key === column.sortKey ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                    : undefined}
                  className={cn('px-3 py-2.5 text-start text-[12px] font-semibold whitespace-nowrap text-muted', column.className)}
                >
                  {column.sortKey && onSortChange
                    ? <SortHeader column={column} sort={sort} onSortChange={onSortChange} />
                    : column.header}
                </th>
              ))}
              {actions ? (
                <th scope="col" className="sticky end-0 bg-surface px-3 py-2.5 text-end text-[12px] font-semibold text-muted">
                  <span className="sr-only">إجراءات</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = rowTone?.(row);
              return (
                <tr
                  key={getRowKey(row)}
                  className={cn('group border-b border-line/70 last:border-b-0 hover:bg-surface/60', tone && toneEdge[tone])}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('px-3 py-2.5 align-middle', column.numeric && 'tabular', column.className)}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {actions ? (
                    <td className="sticky end-0 bg-paper px-3 py-2 group-hover:bg-surface">
                      {actions(row)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          {hasFooter ? (
            <tfoot>
              <tr className="border-t-2 border-line bg-surface/70 font-semibold">
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-3 py-2.5', column.numeric && 'tabular')}>
                    {column.footer}
                  </td>
                ))}
                {actions ? <td className="sticky end-0 bg-surface" /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  }

  const byRole = (role: MobileRole) => columns.filter((column) => (column.mobile ?? 'meta') === role);
  const [primary] = byRole('primary');
  const secondary = byRole('secondary');
  const status = byRole('status');
  const amount = byRole('amount');
  const meta = byRole('meta');

  return (
    <ul aria-label={label} aria-busy={loading || undefined} className={cn('space-y-2', loading && 'opacity-70', className)}>
      {rows.map((row) => {
        const tone = rowTone?.(row);
        return (
          <li
            key={getRowKey(row)}
            className={cn('rounded-card border border-line bg-paper p-3 shadow-card', tone && toneEdge[tone])}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {primary ? <div className="truncate text-[15px] font-semibold text-ink">{primary.cell(row)}</div> : null}
                {secondary.map((column) => (
                  <div key={column.key} className="truncate text-[13px] text-muted">{column.cell(row)}</div>
                ))}
              </div>
              {status.length > 0 ? (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {status.map((column) => <div key={column.key}>{column.cell(row)}</div>)}
                </div>
              ) : null}
            </div>
            {meta.length > 0 ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                {meta.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-[11px] text-muted">{column.header}</dt>
                    <dd className={cn('truncate text-ink', column.numeric && 'tabular')}>{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {amount.length > 0 || actions ? (
              <div className="mt-2 flex flex-wrap items-end justify-between gap-2 border-t border-line/70 pt-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {amount.map((column) => (
                    <div key={column.key}>
                      <span className="block text-[11px] text-muted">{column.header}</span>
                      <span className="tabular text-base font-semibold text-ink">{column.cell(row)}</span>
                    </div>
                  ))}
                </div>
                {actions ? <div className="ms-auto">{actions(row)}</div> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

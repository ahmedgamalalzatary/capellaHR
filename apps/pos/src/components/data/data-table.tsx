import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

import { cn } from '@capella/ui';

/**
 * The ledger table. Every workspace uses the same frame so column rhythm, header
 * weight and row separation never drift, and a wide table always scrolls inside
 * its own card instead of pushing the page sideways.
 */
export function DataTable({
  children,
  className,
  minWidth,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Set when the table must keep a readable width and scroll instead of squeezing.
   * The default holds every column at its full content width, which is right for a
   * ledger of dates and amounts but pushes a table with many columns and a row of
   * buttons past the card — pass `min-w-full` there and let the wide cells wrap.
   */
  minWidth?: string;
}) {
  return (
    <div className={cn('scroll-thin w-full overflow-x-auto', className)}>
      <table className={cn('w-full text-sm', minWidth ?? 'min-w-max')}>{children}</table>
    </div>
  );
}

/** Header row wrapper: pass `TH` cells as children. */
export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line bg-surface/60">{children}</tr>
    </thead>
  );
}

export function TH({
  className,
  numeric,
  pinned,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; pinned?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-2 py-2.5 text-[12px] font-semibold tracking-wide text-muted',
        numeric ? 'text-start' : 'text-start',
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'group border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface/70',
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  numeric,
  pinned,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; pinned?: boolean }) {
  return (
    <td
      className={cn(
        'px-2 py-2.5 align-middle',
        numeric ? 'tabular text-start' : 'text-start',
        className,
      )}
      {...props}
    />
  );
}

/** Row action cluster: wraps on a narrow till without breaking the row height. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1">{children}</div>;
}

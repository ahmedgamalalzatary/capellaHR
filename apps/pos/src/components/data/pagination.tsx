'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, cn, SmartPagination } from '@capella/ui';

/**
 * Shared pager. The caller supplies its own summary wording so each workspace
 * keeps the unit it counts ("عميل", "حساب", "سجل") while the controls stay identical.
 *
 * The chevrons follow the reading direction: "previous" points to the start of an
 * RTL page, which is the right-hand side.
 */
export function Pagination({
  summary,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  className,
  page,
  totalPages,
  onPage,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  persistenceKey,
  resultSetKey,
}: {
  summary?: ReactNode;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Pass `border-t-0` when the pager is the only thing inside its own card. */
  className?: string;
  /** Smart mode: when all three are given, numbered buttons + jump-to-page render. */
  page?: number;
  totalPages?: number;
  onPage?: (page: number) => void;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  persistenceKey?: string;
  resultSetKey?: string;
}) {
  if (page !== undefined && totalPages !== undefined && onPage) {
    return (
      <SmartPagination
        page={page}
        totalPages={totalPages}
        onPage={onPage}
        {...(persistenceKey !== undefined ? { persistenceKey } : {})}
        {...(resultSetKey !== undefined ? { resultSetKey } : {})}
        {...(summary !== undefined ? { summary } : {})}
        {...(className !== undefined ? { className } : {})}
        {...(pageSize !== undefined &&
        pageSizeOptions !== undefined &&
        onPageSizeChange !== undefined
          ? { pageSize, pageSizeOptions, onPageSizeChange }
          : {})}
      />
    );
  }
  return (
    <div className={cn(
      'flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-4 py-3 text-sm',
      className,
    )}>
      {summary ? <div className="text-muted">{summary}</div> : <span />}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={previousDisabled} onClick={onPrevious}>
          <ChevronRight className="size-4" aria-hidden />
          السابق
        </Button>
        <Button variant="secondary" size="sm" disabled={nextDisabled} onClick={onNext}>
          التالي
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

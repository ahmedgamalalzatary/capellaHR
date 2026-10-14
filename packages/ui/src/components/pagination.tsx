'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../lib/cn';
import { getVisiblePages } from '../lib/pagination';
import { Button } from './button';
import { Select } from './select';

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Rows across all pages for the current filter. */
  total: number;
  /** What a row is, e.g. "فاتورة", "عميل". */
  unit: string;
  onPageChange: (page: number) => void;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
}

/**
 * The one pager. Always says "صفحة X من Y — N {unit}" and hides itself when one page holds
 * everything. Phones get previous/next only; wider screens add numbered pages.
 * The page lives in the URL (useListState), so back/forward and shared links keep it.
 */
export function Pagination({
  page,
  totalPages,
  total,
  unit,
  onPageChange,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  const go = (next: number) => {
    if (next < 1 || next > totalPages || next === page) return;
    onPageChange(next);
  };

  return (
    <nav
      aria-label="الصفحات"
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm', className)}
    >
      <p className="tabular text-[13px] text-muted">
        صفحة {page} من {totalPages} — {total} {unit}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" aria-label="الصفحة السابقة" disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronRight className="size-4" aria-hidden />
          <span className="max-sm:sr-only">السابق</span>
        </Button>
        <span className="hidden items-center gap-1 sm:inline-flex">
          {getVisiblePages(page, totalPages).map((item, index) =>
            item === '…' ? (
              <span key={`gap-${index}`} aria-hidden className="px-1 text-muted">…</span>
            ) : (
              <Button
                key={item}
                variant={item === page ? 'board' : 'ghost'}
                size="sm"
                className="tabular min-w-(--control-h-sm) px-2"
                aria-label={`الصفحة ${item}`}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => go(item)}
              >
                {item}
              </Button>
            ),
          )}
        </span>
        <Button variant="secondary" size="sm" aria-label="الصفحة التالية" disabled={page >= totalPages} onClick={() => go(page + 1)}>
          <span className="max-sm:sr-only">التالي</span>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        {pageSize !== undefined && pageSizeOptions && onPageSizeChange ? (
          <Select
            aria-label="عدد الصفوف في الصفحة"
            className="h-(--control-h-sm) w-auto"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{option} / صفحة</option>
            ))}
          </Select>
        ) : null}
      </div>
    </nav>
  );
}

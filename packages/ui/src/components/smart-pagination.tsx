'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { getVisiblePages } from '../lib/pagination';
import { Button } from './button';

export interface SmartPaginationProps {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  summary?: ReactNode;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
}

/**
 * Shared pager: numbered buttons + jump-to-page + optional page-size.
 * Replaces the Prev/Next-only inline pagers across web lists.
 */
export function SmartPagination({
  page,
  totalPages,
  onPage,
  summary,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  className,
}: SmartPaginationProps) {
  const [draft, setDraft] = useState('');
  if (totalPages <= 1) return null;
  const items = getVisiblePages(page, totalPages);
  const jump = () => {
    const next = Number(draft);
    if (Number.isInteger(next) && next >= 1 && next <= totalPages && next !== page) {
      onPage(next);
    }
    setDraft('');
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-4 py-3 text-sm',
        className,
      )}
    >
      {summary ? <div className="text-muted">{summary}</div> : <span />}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          السابق
        </Button>
        {items.map((item, index) =>
          item === '…' ? (
            <span key={`gap-${index}`} className="px-1 text-muted" aria-hidden>
              …
            </span>
          ) : (
            <Button
              key={item}
              variant={item === page ? 'primary' : 'ghost'}
              size="sm"
              disabled={item === page}
              onClick={() => onPage(item)}
              aria-label={`الصفحة ${item}`}
              aria-current={item === page ? 'page' : undefined}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          التالي
        </Button>
        <label className="ms-2 flex items-center gap-1 text-[13px] text-muted">
          صفحة
          <input
            className="h-8 w-14 rounded-control border border-line bg-paper px-2 text-center text-sm text-ink"
            inputMode="numeric"
            placeholder={`${page}/${totalPages}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') jump();
            }}
            aria-label="انتقال إلى صفحة"
          />
        </label>
        {pageSize !== undefined && pageSizeOptions && onPageSizeChange ? (
          <label className="flex items-center gap-1 text-[13px] text-muted">
            لكل صفحة
            <select
              className="h-8 rounded-control border border-line bg-paper px-2 text-sm text-ink"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              aria-label="عدد العناصر لكل صفحة"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}

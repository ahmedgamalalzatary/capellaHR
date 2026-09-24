'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  persistenceKey?: string;
  resultSetKey?: string;
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
  persistenceKey,
  resultSetKey,
}: SmartPaginationProps) {
  const [draft, setDraft] = useState('');
  const restoredKey = useRef<string | undefined>(undefined);
  const resultIdentity = resultSetKey ?? '';
  const storageKey = typeof window === 'undefined'
    ? undefined
    : `capella:pagination:${persistenceKey ?? window.location.pathname}:${resultIdentity}`;
  useEffect(() => {
    if (!storageKey || totalPages <= 1) return;
    if (restoredKey.current !== storageKey) {
      restoredKey.current = storageKey;
      const storedPage = Number(window.sessionStorage.getItem(storageKey));
      if (Number.isInteger(storedPage) && storedPage >= 1 && storedPage <= totalPages && storedPage !== page) {
        onPage(storedPage);
        return;
      }
    }
    window.sessionStorage.setItem(storageKey, String(page));
  }, [onPage, page, storageKey, totalPages]);
  const selectPage = (next: number) => {
    if (storageKey && next >= 1 && next <= totalPages) {
      window.sessionStorage.setItem(storageKey, String(next));
    }
    (document.activeElement as HTMLElement | null)?.blur();
    onPage(next);
    window.scrollTo(0, 0);
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  };
  if (totalPages <= 1) return null;
  const items = getVisiblePages(page, totalPages);
  const jump = () => {
    const next = Number(draft);
    if (Number.isInteger(next) && next >= 1 && next <= totalPages && next !== page) {
      selectPage(next);
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
          onClick={() => selectPage(page - 1)}
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
              onClick={() => selectPage(item)}
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
          onClick={() => selectPage(page + 1)}
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

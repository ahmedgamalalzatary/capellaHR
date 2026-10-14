'use client';

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { useMatchMedia, WIDE_QUERY } from '../hooks/use-match-media';
import { SEARCH_DELAY_MS } from '../hooks/use-debounced-value';
import { cn } from '../lib/cn';
import { Button } from './button';
import { controlClassName } from './control-styles';
import { EmptyState } from './empty-state';
import { Modal } from './modal';

/* ------------------------------------------------------------------------------------------------
 * SearchInput: applies 500 ms after the last keystroke. No search button anywhere.
 * --------------------------------------------------------------------------------------------- */

export interface SearchInputProps {
  /** Accessible name, e.g. "بحث الفواتير". */
  label: string;
  /** Says what it searches: "بحث بالاسم أو الهاتف أو الكود". */
  placeholder: string;
  /** The applied search (from useListState). */
  value: string;
  onSearch: (value: string) => void;
  className?: string;
}

export function SearchInput({ label, placeholder, value, onSearch, className }: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  // Follow the applied value when it changes from outside (reset, back button, a link).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onSearch(draft), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // Restart the wait only when the text or the applied value changes, not on a new callback.
  }, [draft, value]);

  return (
    <div className={cn('relative min-w-0 flex-1 sm:min-w-56', className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        enterKeyHint="search"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (draft !== value) onSearch(draft);
          }
        }}
        className={cn(controlClassName, 'h-(--control-h) ps-9 pe-9 [&::-webkit-search-cancel-button]:hidden')}
      />
      {draft ? (
        <button
          type="button"
          aria-label="مسح البحث"
          onClick={() => {
            setDraft('');
            onSearch('');
          }}
          className="absolute end-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:bg-surface hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * FilterBar: one layout everywhere. Search, then the filters, then reset with the active count.
 * Phones: search stays; the filters move into a bottom sheet behind "تصفية (N)".
 * --------------------------------------------------------------------------------------------- */

export interface FilterChip {
  key: string;
  /** e.g. "الحالة: مدفوعة" */
  label: string;
  onRemove: () => void;
}

export interface FilterBarProps {
  /** Accessible name of the search region, e.g. "تصفية الفواتير". */
  label: string;
  search?: ReactNode;
  /** The filter controls (labelled selects, DateRangeFilter, Combobox…). They apply live. */
  children?: ReactNode;
  activeCount: number;
  onReset: () => void;
  /** Active filters as removable chips under the bar. */
  chips?: readonly FilterChip[];
  className?: string;
}

export function FilterBar({ label, search, children, activeCount, onReset, chips = [], className }: FilterBarProps) {
  const wide = useMatchMedia(WIDE_QUERY, true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const resetLabel = activeCount > 0 ? `إعادة ضبط (${activeCount})` : 'إعادة ضبط';

  const reset = (
    <Button variant="ghost" size="sm" disabled={activeCount === 0} onClick={onReset} className="text-brand-strong">
      {resetLabel}
    </Button>
  );

  return (
    <div className={cn('space-y-2', className)}>
      <div role="search" aria-label={label}>
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-paper p-2 shadow-card sm:p-3">
          {search}
          {wide ? (
            <>
              {children ? <div className="flex flex-wrap items-end gap-2">{children}</div> : null}
              <div className="ms-auto">{reset}</div>
            </>
          ) : children ? (
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
              <SlidersHorizontal className="size-4" aria-hidden />
              {activeCount > 0 ? `تصفية (${activeCount})` : 'تصفية'}
            </Button>
          ) : null}
        </div>
      </div>

      {chips.length > 0 ? (
        <ul aria-label="عوامل التصفية المفعلة" className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li key={chip.key}>
              <span className="inline-flex items-center gap-1 rounded-full border border-brand/25 bg-brand-soft py-0.5 ps-2.5 pe-1 text-[12px] text-brand-strong">
                {chip.label}
                <button
                  type="button"
                  aria-label={`إزالة ${chip.label}`}
                  onClick={chip.onRemove}
                  className="inline-flex size-6 items-center justify-center rounded-full hover:bg-brand/15"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!wide && sheetOpen ? (
        <Modal
          title="تصفية"
          onClose={() => setSheetOpen(false)}
          footer={(
            <>
              <Button className="flex-1" onClick={() => setSheetOpen(false)}>عرض النتائج</Button>
              {reset}
            </>
          )}
        >
          <div className="grid gap-3 [&_select]:w-full [&_input]:w-full">{children}</div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * ListEmptyState: tells "nothing matches your filter" apart from "nothing here yet".
 * --------------------------------------------------------------------------------------------- */

export function ListEmptyState({ isFiltered, onReset, title, description, action, className }: {
  isFiltered: boolean;
  onReset: () => void;
  /** First-run message, e.g. "لا توجد فواتير بعد". */
  title: string;
  description?: string;
  /** First-run action (e.g. the page's create button). */
  action?: ReactNode;
  className?: string;
}) {
  return isFiltered ? (
    <EmptyState
      title="لا توجد نتائج مطابقة"
      description="جرّب كلمة بحث أخرى أو غيّر عوامل التصفية."
      action={<Button variant="secondary" size="sm" onClick={onReset}>إعادة ضبط التصفية</Button>}
      {...(className ? { className } : {})}
    />
  ) : (
    <EmptyState title={title} description={description} action={action} {...(className ? { className } : {})} />
  );
}

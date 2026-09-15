'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from './button';
import { AR_MONTH_NAMES, formatMonthValue, parseMonthValue } from '../lib/months';
import { cn } from '../lib/cn';

export interface MonthPickerProps {
  /** Unique id for the trigger button (pairs with the external visible label). */
  id: string;
  /** Screen-reader name for the trigger (e.g. `تصفية حسب الشهر`). */
  filterLabel: string;
  /** Current value: `''` (all months) or `YYYY-MM`. */
  value: string;
  /** Receives the next `YYYY-MM` (or `''` when cleared). */
  onChange: (next: string) => void;
  /** Trigger text when nothing is picked. Defaults to `كل الشهور`. */
  placeholder?: string;
  /** Clear-action text. Defaults to `مسح الشهر`. */
  clearLabel?: string;
  className?: string;
}

const pad2 = (month: number) => String(month).padStart(2, '0');

/**
 * Calendar-style month picker. A button trigger opens a year/month grid so
 * users pick instead of typing — no free-text month entry.
 */
export function MonthPicker({
  id,
  filterLabel,
  value,
  onChange,
  placeholder = 'كل الشهور',
  clearLabel = 'مسح الشهر',
  className,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [shownYear, setShownYear] = useState(() => parseMonthValue(value)?.year ?? new Date().getFullYear());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const pick = (month: number) => {
    onChange(`${shownYear}-${pad2(month)}`);
    setOpen(false);
  };
  const clear = () => {
    onChange('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Button
        id={id}
        type="button"
        variant="secondary"
        size="sm"
        aria-label={filterLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="h-9 min-w-44 justify-between px-3 text-sm font-normal"
      >
        <span className={value ? '' : 'text-muted'}>{value ? formatMonthValue(value) : placeholder}</span>
        <span aria-hidden className="text-muted">▾</span>
      </Button>
      {open ? (
        <div role="dialog" aria-label={filterLabel} className="absolute start-0 z-30 mt-1 w-64 rounded-card border border-line bg-paper p-3 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" aria-label="السنة السابقة" onClick={() => setShownYear((year) => year - 1)}>
              ‹
            </Button>
            <span className="tabular text-sm font-medium">{shownYear}</span>
            <Button type="button" variant="ghost" size="sm" aria-label="السنة التالية" onClick={() => setShownYear((year) => year + 1)}>
              ›
            </Button>
          </div>
          <div role="group" aria-label={filterLabel} className="grid grid-cols-3 gap-1">
            {AR_MONTH_NAMES.map((name, index) => {
              const month = index + 1;
              const selected = value === `${shownYear}-${pad2(month)}`;
              return (
                <Button
                  key={name}
                  type="button"
                  variant={selected ? 'primary' : 'ghost'}
                  size="sm"
                  aria-pressed={selected}
                  onClick={() => pick(month)}
                >
                  {name}
                </Button>
              );
            })}
          </div>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={clear} className="mt-2 w-full">
              {clearLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

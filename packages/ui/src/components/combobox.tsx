'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';

import { cn } from '../lib/cn';
import { controlClassName } from './control-styles';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Second line (branch, barcode, phone); also searched. */
  hint?: string;
}

/** Folds Arabic spelling variants so "احمد" finds "أحمد" and "فاطمه" finds "فاطمة". */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, '') // diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLocaleLowerCase('ar')
    .trim();
}

/** Long lists stay fast: render this many matches, and ask for more typing beyond it. */
const VISIBLE_LIMIT = 50;

export interface ComboboxProps {
  /** Visible label text; also the accessible name. */
  label: string;
  /** Hide the visible label when the surrounding layout already shows one. */
  hideLabel?: boolean;
  id?: string;
  options: readonly ComboboxOption[];
  /** Chosen value, `''` for none / all. */
  value: string;
  onChange: (value: string) => void;
  /** Shown when nothing is chosen (e.g. "كل الموظفين"). */
  allLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A searchable select for long lists (employees, products, suppliers, clients). Type to narrow,
 * arrows to move, Enter to pick, Escape to cancel. Matching ignores Arabic spelling variants.
 */
export function Combobox({
  label,
  hideLabel = false,
  id,
  options,
  value,
  onChange,
  allLabel = 'الكل',
  disabled = false,
  className,
}: ComboboxProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const selected = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    if (!query) return options;
    const needle = normalizeArabic(query);
    return options.filter((option) =>
      normalizeArabic(option.label).includes(needle) || (option.hint ? normalizeArabic(option.hint).includes(needle) : false));
  }, [options, query]);
  const shown = matches.slice(0, VISIBLE_LIMIT);

  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const pick = (option: ComboboxOption) => {
    onChange(option.value);
    close();
  };
  const openAt = (index: number) => {
    setOpen(true);
    setActiveIndex(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openAt(Math.max(0, shown.findIndex((option) => option.value === value)));
      else setActiveIndex((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (open) setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const option = shown[activeIndex];
      if (open && option) {
        event.preventDefault();
        pick(option);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const activeId = open && shown[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  return (
    <div className={cn('relative min-w-48', className)}>
      <label htmlFor={inputId} className={cn('mb-1 block text-[12px] font-medium text-muted', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          disabled={disabled}
          placeholder={allLabel}
          value={query ?? selected?.label ?? ''}
          onChange={(event) => {
            setQuery(event.target.value);
            openAt(0);
          }}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={close}
          onKeyDown={onKeyDown}
          className={cn(controlClassName, 'h-(--control-h) pe-16')}
        />
        <div className="absolute end-1 top-1/2 flex -translate-y-1/2 items-center">
          {value && !disabled ? (
            <button
              type="button"
              aria-label={`مسح ${label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange('')}
              className="inline-flex size-7 items-center justify-center rounded-control text-muted hover:bg-surface hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
          <ChevronDown className="pointer-events-none mx-1 size-4 text-muted" aria-hidden />
        </div>
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="scroll-thin absolute inset-x-0 top-full z-(--z-drawer) mt-1 max-h-72 overflow-y-auto rounded-control border border-line bg-paper p-1 shadow-raised"
      >
        {open && shown.length === 0 ? (
          <p className="px-2.5 py-2 text-[13px] text-muted">لا توجد نتائج</p>
        ) : null}
        {open
          ? shown.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-cell px-2.5 py-2 text-sm',
                  index === activeIndex ? 'bg-surface' : '',
                )}
              >
                <Check className={cn('size-4 shrink-0 text-brand-strong', !isSelected && 'invisible')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{option.label}</span>
                  {option.hint ? <span className="block truncate text-[12px] text-muted">{option.hint}</span> : null}
                </span>
              </div>
            );
          })
          : null}
        {open && matches.length > VISIBLE_LIMIT ? (
          <p className="px-2.5 py-1.5 text-[12px] text-muted">
            تظهر أول {VISIBLE_LIMIT} من {matches.length} — اكتب لتضييق النتائج
          </p>
        ) : null}
      </div>
    </div>
  );
}

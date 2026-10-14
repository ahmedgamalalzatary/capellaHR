'use client';

import { useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '../lib/cn';
import { formatters } from '../lib/format';
import { MonthPicker } from './month-picker';
import { Select } from './select';

/** A labelled slot in the FilterBar: small label above the control. */
export function FilterField({ label, htmlFor, children, className }: {
  label: string;
  htmlFor?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

export interface FilterSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  /** First option meaning "no filter" (value `''`), e.g. "كل الحالات". */
  allLabel?: string;
}

/** A labelled native select for short lists (status, payment method, branch). */
export function FilterSelect({ label, value, onChange, options, allLabel, id, className, ...props }: FilterSelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <FilterField label={label} htmlFor={selectId} className={className}>
      <Select id={selectId} value={value} onChange={(event) => onChange(event.target.value)} className="sm:w-auto sm:min-w-40" {...props}>
        {allLabel === undefined ? null : <option value="">{allLabel}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </FilterField>
  );
}

/** Branch filter (admins). Options come from the app's `useBranchOptions()`. */
export function BranchSelect(props: Omit<FilterSelectProps, 'label' | 'allLabel'> & { label?: string; allLabel?: string }) {
  return <FilterSelect label={props.label ?? 'الفرع'} allLabel={props.allLabel ?? 'كل الفروع'} {...props} />;
}

/* ------------------------------------------------------------------------------------------------
 * Dates
 * --------------------------------------------------------------------------------------------- */

const shiftDay = (isoDay: string, days: number) => {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export interface DatePreset {
  label: string;
  from: string;
  to: string;
}

/** Quick ranges in Cairo days. The week starts on Saturday, as at the branches. */
export function datePresets(now: Date = new Date()): DatePreset[] {
  const today = formatters.cairoToday(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  const sinceSaturday = (weekday + 1) % 7;
  return [
    { label: 'اليوم', from: today, to: today },
    { label: 'أمس', from: shiftDay(today, -1), to: shiftDay(today, -1) },
    { label: 'هذا الأسبوع', from: shiftDay(today, -sinceSaturday), to: today },
    { label: 'هذا الشهر', from: `${today.slice(0, 8)}01`, to: today },
  ];
}

export interface DateRangeFilterProps {
  /** `YYYY-MM-DD` or `''`. */
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  label?: string;
  presets?: boolean;
  /** For tests. */
  now?: Date;
  className?: string;
}

/**
 * From/to dates with quick presets. A range whose start is after its end is refused with an
 * inline message instead of silently returning nothing.
 */
export function DateRangeFilter({ from, to, onChange, label = 'الفترة', presets = true, now, className }: DateRangeFilterProps) {
  const id = useId();
  const [draft, setDraft] = useState({ from, to });
  const [applied, setApplied] = useState({ from, to });
  if (applied.from !== from || applied.to !== to) {
    setApplied({ from, to });
    setDraft({ from, to });
  }
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);

  const update = (next: { from: string; to: string }) => {
    setDraft(next);
    if (!(next.from && next.to && next.from > next.to)) onChange(next);
  };

  const inputClassName = 'h-(--control-h) w-full rounded-control border border-line bg-paper px-2 text-sm text-ink tabular aria-invalid:border-danger sm:w-36';

  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="mb-1 block text-[12px] font-medium text-muted">{label}</legend>
      <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="min-w-0">
          <label htmlFor={`${id}-from`} className="mb-0.5 block text-[11px] text-muted sm:sr-only">من</label>
          <input
            id={`${id}-from`}
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => update({ ...draft, from: event.target.value })}
            className={inputClassName}
          />
        </div>
        <span aria-hidden className="hidden text-muted sm:inline">—</span>
        <div className="min-w-0">
          <label htmlFor={`${id}-to`} className="mb-0.5 block text-[11px] text-muted sm:sr-only">إلى</label>
          <input
            id={`${id}-to`}
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            aria-invalid={invalid || undefined}
            onChange={(event) => update({ ...draft, to: event.target.value })}
            className={inputClassName}
          />
        </div>
      </div>
      {presets ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {datePresets(now).map((preset) => {
            const active = preset.from === from && preset.to === to;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                onClick={() => update({ from: preset.from, to: preset.to })}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 pointer-coarse:py-1.5',
                  active ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-muted hover:text-ink',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {invalid ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[12px] text-danger">تاريخ البداية بعد تاريخ النهاية</p>
      ) : null}
    </fieldset>
  );
}

/** One month picker for admin and self-service filters (`YYYY-MM` or `''`). */
export function MonthFilter({ label = 'الشهر', value, onChange, allowAll = true, className }: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** When false, a month must stay chosen (payroll). */
  allowAll?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <FilterField label={label} htmlFor={id} className={className}>
      <MonthPicker
        id={id}
        filterLabel={`تصفية حسب ${label}`}
        value={value}
        onChange={(next) => { if (next || allowAll) onChange(next); }}
      />
    </FilterField>
  );
}

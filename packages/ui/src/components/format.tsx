'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { createFormatters, formatDuration, formatters, type DisplaySettings, type Formatters } from '../lib/format';

const FormattersContext = createContext<Formatters>(formatters);

/** Web wraps its tree with the backend's display settings; POS uses the Cairo defaults. */
export function FormattersProvider({ settings, children }: { settings: DisplaySettings; children: ReactNode }) {
  const value = useMemo(() => createFormatters(settings), [settings]);
  return <FormattersContext.Provider value={value}>{children}</FormattersContext.Provider>;
}

export function useFormatters() {
  return useContext(FormattersContext);
}

type DateInput = Date | string | number;

/** Money with tabular figures. Negative amounts read in the danger colour when `signed`. */
export function Money({ value, currency = true, signed = false, className }: {
  value: number | string;
  currency?: boolean;
  signed?: boolean;
  className?: string;
}) {
  const format = useFormatters();
  return (
    <span dir="ltr" className={cn('tabular whitespace-nowrap', signed && Number(value) < 0 && 'text-danger', className)}>
      {format.money(value, { currency })}
    </span>
  );
}

/** A moment (ISO timestamp) in Cairo time: date + time, date only, or time only. */
export function DateTime({ value, show = 'dateTime', className }: {
  value: DateInput;
  show?: 'dateTime' | 'date' | 'time';
  className?: string;
}) {
  const format = useFormatters();
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return <time dateTime={iso} className={cn('tabular whitespace-nowrap', className)}>{format[show](value)}</time>;
}

/** A calendar date (`YYYY-MM-DD`), never shifted by the time zone. */
export function DateOnly({ value, className }: { value: string; className?: string }) {
  const format = useFormatters();
  return <time dateTime={value.slice(0, 10)} className={cn('tabular whitespace-nowrap', className)}>{format.dateOnly(value)}</time>;
}

/** Whole minutes as h:mm. */
export function Duration({ minutes, className }: { minutes: number; className?: string }) {
  return <span dir="ltr" className={cn('tabular whitespace-nowrap', className)}>{formatDuration(minutes)}</span>;
}

/** A phone number, isolated left-to-right so the digits never reorder inside Arabic text. */
export function Phone({ value, className }: { value: string; className?: string }) {
  return <bdi dir="ltr" className={cn('tabular whitespace-nowrap', className)}>{value}</bdi>;
}

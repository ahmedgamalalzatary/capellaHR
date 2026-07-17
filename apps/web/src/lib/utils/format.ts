/**
 * Display formatting — everything renders in Africa/Cairo with Western
 * digits (locked design decision: `ar-EG-u-nu-latn`).
 */

export const CAIRO_TIME_ZONE = 'Africa/Cairo';

const ARABIC_LOCALE = 'ar-EG-u-nu-latn';

const dateFormatter = new Intl.DateTimeFormat(ARABIC_LOCALE, {
  timeZone: CAIRO_TIME_ZONE,
  dateStyle: 'medium',
});

const timeFormatter = new Intl.DateTimeFormat(ARABIC_LOCALE, {
  timeZone: CAIRO_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dateTimeFormatter = new Intl.DateTimeFormat(ARABIC_LOCALE, {
  timeZone: CAIRO_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const moneyFormatter = new Intl.NumberFormat(ARABIC_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCairoDate(value: Date | string | number): string {
  return dateFormatter.format(new Date(value));
}

export function formatCairoTime(value: Date | string | number): string {
  return timeFormatter.format(new Date(value));
}

export function formatCairoDateTime(value: Date | string | number): string {
  return dateTimeFormatter.format(new Date(value));
}

/** EGP amount, e.g. "1,234.56 ج.م" */
export function formatMoney(amount: number | string): string {
  return `${moneyFormatter.format(Number(amount))} ج.م`;
}

/** Whole minutes as "س:د", e.g. 510 → "8:30" */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.abs(totalMinutes % 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

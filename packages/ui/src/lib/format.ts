export interface DisplaySettings {
  locale: string;
  timeZone: string;
}

/** The product runs in Arabic on Cairo time (PRODUCT.md). Web passes the backend's runtime settings. */
export const defaultDisplaySettings: DisplaySettings = { locale: 'ar-EG', timeZone: 'Africa/Cairo' };

type DateInput = Date | string | number;

/**
 * The only formatters pages use: no raw ISO anywhere. Money keeps Western digits and two decimals
 * (as receipts and reports print them); dates and times use the Arabic locale in Cairo time.
 */
export function createFormatters(settings: DisplaySettings = defaultDisplaySettings) {
  const { locale, timeZone } = settings;
  const date = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' });
  const dateTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });
  // A calendar date has no zone: format it at UTC midnight so it never moves a day.
  const dateOnly = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' });
  const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return {
    date: (value: DateInput) => date.format(new Date(value)),
    dateTime: (value: DateInput) => dateTime.format(new Date(value)),
    time: (value: DateInput) => time.format(new Date(value)),
    /** A `YYYY-MM-DD` value (bookings day, expense date, month start). */
    dateOnly: (value: string) => dateOnly.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)),
    /** EGP amount, e.g. "1,234.50 ج.م". */
    money: (amount: number | string, options: { currency?: boolean } = {}) => {
      const text = money.format(Number(amount));
      return options.currency === false ? text : `${text} ج.م`;
    },
    /** Today's date in the display zone as `YYYY-MM-DD` (for date inputs and API filters). */
    cairoToday: (now: Date = new Date()) => isoDay.format(now),
  };
}

export type Formatters = ReturnType<typeof createFormatters>;

export const formatters = createFormatters();

/** Whole minutes as "h:mm", e.g. 510 → "8:30". */
export function formatDuration(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(totalMinutes));
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`;
}

export interface DisplaySettings {
  locale: string;
  timeZone: string;
}

/** Builds display formatters exclusively from backend-provided runtime settings. */
export function createDisplayFormatters(settings: DisplaySettings) {
  const dateFormatter = new Intl.DateTimeFormat(settings.locale, {
    timeZone: settings.timeZone,
    dateStyle: 'medium',
  });
  const timeFormatter = new Intl.DateTimeFormat(settings.locale, {
    timeZone: settings.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const dateTimeFormatter = new Intl.DateTimeFormat(settings.locale, {
    timeZone: settings.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const moneyFormatter = new Intl.NumberFormat(settings.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    formatDate: (value: Date | string | number) => dateFormatter.format(new Date(value)),
    formatTime: (value: Date | string | number) => timeFormatter.format(new Date(value)),
    formatDateTime: (value: Date | string | number) => dateTimeFormatter.format(new Date(value)),
    /** EGP amount, e.g. "1,234.56 ج.م". */
    formatMoney: (amount: number | string) => `${moneyFormatter.format(Number(amount))} ج.م`,
  };
}

export type DisplayFormatters = ReturnType<typeof createDisplayFormatters>;

/** Whole minutes as "س:د", e.g. 510 → "8:30" */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.abs(totalMinutes % 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

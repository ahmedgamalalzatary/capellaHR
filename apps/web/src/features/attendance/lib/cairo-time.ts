import { TZDate } from '@date-fns/tz';

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Interprets a datetime-local value as Cairo wall time, independent of the browser's zone. */
export function cairoLocalDateTimeToIso(value: string): string | null {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const result = new TZDate(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
    'Africa/Cairo',
  );
  if (
    result.getFullYear() !== Number(year)
    || result.getMonth() !== Number(month) - 1
    || result.getDate() !== Number(day)
    || result.getHours() !== Number(hour)
    || result.getMinutes() !== Number(minute)
  ) return null;
  // Cairo repeats one hour when daylight saving ends. For an edited wall time
  // in that hour, use its later occurrence rather than TZDate's earlier one.
  const later = new TZDate(result.getTime() + 60 * 60_000, 'Africa/Cairo');
  if (
    later.getFullYear() === result.getFullYear()
    && later.getMonth() === result.getMonth()
    && later.getDate() === result.getDate()
    && later.getHours() === result.getHours()
    && later.getMinutes() === result.getMinutes()
  ) return later.toISOString();
  return result.toISOString();
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Renders a stored timestamp as a Cairo wall-clock datetime-local value. */
export function isoToCairoDateTimeLocal(value: string): string | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ''
  );
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

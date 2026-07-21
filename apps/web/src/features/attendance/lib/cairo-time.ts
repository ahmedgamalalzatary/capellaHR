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
  return result.toISOString();
}

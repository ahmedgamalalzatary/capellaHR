const dateAt = (instant: Date, formatter: Intl.DateTimeFormat) => {
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const startOfDate = (value: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60_000;
  let high = target + 36 * 60 * 60_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(new Date(middle), formatter) < value) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

export const endOfDate = (value: string, timeZone: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return new Date(startOfDate(next, timeZone).valueOf() - 1);
};

export const nextCalendarDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

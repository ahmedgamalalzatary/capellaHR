const cairoDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((entry) => entry.type === type)!.value
  );
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const cairoMonth = (value: Date) => cairoDate(value).slice(0, 7);

export const startOfCairoDate = (value: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dateAt = (instant: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant)
      .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60_000;
  let high = target + 36 * 60 * 60_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(new Date(middle)) < value) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

export const nextMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
};

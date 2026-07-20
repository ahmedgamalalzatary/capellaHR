const calendarDate = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value
  );
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const firstInstantOfDate = (date: string, timeZone: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60_000;
  let high = target + 36 * 60 * 60_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendarDate(new Date(middle), timeZone) < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

const nextDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

export const scheduleCurrentAttendanceDate = async (
  scheduler: {
    findMissingAbsenceScheduleStart(throughDate: string): Promise<string | null>;
    ensureAbsenceJob(date: string, runAt: Date): Promise<unknown>;
  },
  now: Date,
  timeZone: string,
) => {
  const currentDate = calendarDate(now, timeZone);
  let date = await scheduler.findMissingAbsenceScheduleStart(currentDate);
  while (date !== null && date <= currentDate) {
    await scheduler.ensureAbsenceJob(date, firstInstantOfDate(nextDate(date), timeZone));
    date = nextDate(date);
  }
};

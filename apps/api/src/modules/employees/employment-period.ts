export type EmploymentPeriod = { activeFrom: Date; activeTo: Date | null };

const calendarDate = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month').padStart(2, '0')}-${part('day').padStart(2, '0')}`;
};

export const employmentDateIsActive = (
  attendanceDate: string,
  periods: readonly EmploymentPeriod[],
  timeZone: string,
) => periods.some((period) => (
  calendarDate(period.activeFrom, timeZone) <= attendanceDate
  && (period.activeTo === null || calendarDate(period.activeTo, timeZone) >= attendanceDate)
));

// An employee stays employed for the whole calendar day their employment ends, so a session
// worked that day still counts. An absence must not be generated for it: reconciliation runs
// after the fact and would reopen a balance that deactivation already settled.
export const employmentDateAccruesAbsence = (
  attendanceDate: string,
  periods: readonly EmploymentPeriod[],
  timeZone: string,
) => periods.some((period) => (
  calendarDate(period.activeFrom, timeZone) <= attendanceDate
  && (period.activeTo === null || calendarDate(period.activeTo, timeZone) > attendanceDate)
));

export const employmentMonthIsActive = (
  month: string,
  periods: readonly EmploymentPeriod[],
  timeZone: string,
) => periods.some((period) => (
  calendarDate(period.activeFrom, timeZone).slice(0, 7) <= month
  && (period.activeTo === null || calendarDate(period.activeTo, timeZone).slice(0, 7) >= month)
));

/** Arabic month names indexed 0-11 (January first). */
export const AR_MONTH_NAMES = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

const MONTH_VALUE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonthValue(value: string): boolean {
  return MONTH_VALUE_PATTERN.test(value);
}

export function parseMonthValue(value: string): { year: number; month: number } | null {
  const match = MONTH_VALUE_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Renders `YYYY-MM` as an Arabic label (`أغسطس 2026`); unknown input passes through. */
export function formatMonthValue(value: string): string {
  const parsed = parseMonthValue(value);
  if (!parsed) return value;
  return `${AR_MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

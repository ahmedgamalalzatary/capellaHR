import type { createDatabase } from '@capella/database';
import { branches, employees } from '@capella/database/schema';

export type Database = ReturnType<typeof createDatabase>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const LIST_LIMIT = 5;
export const employeeFields = {
  employeeId: employees.id,
  employeeCode: employees.employeeCode,
  employeeName: employees.fullName,
  branchId: branches.id,
  branchName: branches.name,
};

export const previousMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const previous = monthNumber === 1 ? [year - 1, 12] : [year, monthNumber - 1];
  return `${previous[0]}-${String(previous[1]).padStart(2, '0')}`;
};

export const nextMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const next = monthNumber === 12 ? [year + 1, 1] : [year, monthNumber + 1];
  return `${next[0]}-${String(next[1]).padStart(2, '0')}`;
};

export const startOfDate = (value: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60 * 1000;
  let high = target + 36 * 60 * 60 * 1000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const parts = Object.fromEntries(formatter.formatToParts(new Date(middle))
      .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (date < value) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

export const totalOf = async (query: Promise<Array<{ value: number }>>) => Number((await query)[0]?.value ?? 0);

export const rawRows = async <T>(query: ReturnType<Transaction['execute']>) => (
  (await query)[0] as unknown as T[]
);

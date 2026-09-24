import { ApiError } from '@/lib/api/client';

export type DraftLine = { key: number; productId: string; quantity: string; unitCost: string };
export const blankLine = (key: number): DraftLine => ({ key, productId: '', quantity: '1', unitCost: '' });
export const todayInCairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
export const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية. حاول مرة أخرى.';
export const cents = (value: string) => /^\d+(?:\.\d{0,2})?$/.test(value)
  ? BigInt(`${value.split('.')[0] || '0'}${(value.split('.')[1] ?? '').padEnd(2, '0')}`)
  : BigInt(0);
export const quantityValue = (value: string) => {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= BigInt(2_147_483_647) ? parsed : null;
};
export const moneyFromCents = (total: bigint) => {
  const hundred = BigInt(100);
  return `${total / hundred}.${String(total % hundred).padStart(2, '0')}`;
};
export const lineAmount = (line: DraftLine) => moneyFromCents(
  cents(line.unitCost) * (quantityValue(line.quantity) ?? BigInt(0)),
);
export const exactTotal = (lines: DraftLine[]) => moneyFromCents(lines.reduce(
  (sum, line) => sum + cents(line.unitCost) * (quantityValue(line.quantity) ?? BigInt(0)),
  BigInt(0),
));

import { toCents } from './services/sale-calculations.js';

export const isDuplicateEntryError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;
  if (Reflect.get(error, 'code') === 'ER_DUP_ENTRY') return true;
  const cause: unknown = Reflect.get(error, 'cause');
  return typeof cause === 'object' && cause !== null
    && Reflect.get(cause, 'code') === 'ER_DUP_ENTRY';
};

export const signedMoney = (value: bigint) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};

export const commissionCents = (base: bigint, rate: string) => (
  (base * toCents(rate) + 5_000n) / 10_000n
);

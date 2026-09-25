import { z } from 'zod';

export const decimalIntegerInput = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : value;
};

export const positiveMysqlIntSchema = z.number().int().positive().max(2147483647);
export const coercedMysqlIntSchema = z.preprocess(decimalIntegerInput, positiveMysqlIntSchema);
export const paginationPageSchema = coercedMysqlIntSchema;
export const paginationPageSizeSchema = z.preprocess(
  decimalIntegerInput,
  z.number().int().positive().max(100),
);

/** Normalized Egyptian mobile: 11 Western digits starting with 010, 011, 012, or 015. */
const NORMALIZED_EGYPTIAN_MOBILE_PATTERN = /^01[0125]\d{8}$/;

export function containsArabicIndicDigits(value: string): boolean {
  return /[\u0660-\u0669]/u.test(value);
}

export function isNormalizedEgyptianMobile(value: string): boolean {
  return NORMALIZED_EGYPTIAN_MOBILE_PATTERN.test(value);
}

/** Accept Western digits with spaces, dashes, parentheses, or a +20 prefix. */
export function normalizeEgyptianMobile(input: string): string | null {
  if (containsArabicIndicDigits(input)) return null;

  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+20')) {
    digits = `0${digits.slice(3)}`;
  }

  return isNormalizedEgyptianMobile(digits) ? digits : null;
}

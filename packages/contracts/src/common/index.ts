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

import { z } from 'zod';
import { positiveMysqlIntSchema } from '../../../common/index.ts';

export const expiryDateSchema = z.string().date('تاريخ الصلاحية غير صالح');
export const batchQuantitySchema = z.string().regex(/^\d{1,13}(?:\.\d{1,3})?$/)
  .transform((value) => formatBatchQuantity(batchMilli(value)))
  .refine((value) => batchMilli(value) > BigInt(0), 'كمية الدفعة يجب أن تكون أكبر من صفر');
export const batchSelectionSchema = z.object({
  batchId: positiveMysqlIntSchema, quantity: batchQuantitySchema,
}).strict();
export const batchSelectionsSchema = z.array(batchSelectionSchema).min(1).max(100)
  .refine((rows) => new Set(rows.map((row) => row.batchId)).size === rows.length, 'تم تكرار الدفعة');
export const packageBatchSelectionsSchema = batchSelectionsSchema.refine(
  (rows) => rows.every((row) => batchMilli(row.quantity) % BigInt(1000) === BigInt(0)), 'اختر عبوات كاملة لكل دفعة',
);
export const batchSnapshotSchema = batchSelectionSchema.extend({ expiryDate: expiryDateSchema.nullable() });
export type BatchSelection = z.infer<typeof batchSelectionSchema>;
export type BatchAllocation = z.infer<typeof batchSnapshotSchema>;
export type StockBatch = { batchId: number; expiryDate: string | null; quantity: number; consumableQuantity: string };
export const updateBatchExpirySchema = z.object({
  expiryDate: expiryDateSchema.nullable(), branchId: positiveMysqlIntSchema.optional(),
}).strict();

export const batchMilli = (value: string): bigint => {
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(value)) throw new Error('BATCH_QUANTITY_INVALID');
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, '0'));
  return negative ? -amount : amount;
};
export const formatBatchQuantity = (value: bigint): string => {
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? '-' : ''}${absolute / BigInt(1000)}.${String(absolute % BigInt(1000)).padStart(3, '0')}`;
};

export const isBatchSelectionComplete = (selected: BatchSelection[] | undefined, quantity: string, wholeUnits = false): boolean => {
  if (selected === undefined) return true;
  const parsed = (wholeUnits ? packageBatchSelectionsSchema : batchSelectionsSchema).safeParse(selected);
  if (!parsed.success) return false;
  try { return parsed.data.reduce((sum, row) => sum + batchMilli(row.quantity), BigInt(0)) === batchMilli(quantity); }
  catch { return false; }
};

/** FEFO includes expired batches; an unknown date sorts after every known date. */
export const allocateBatchQuantities = (
  available: BatchAllocation[], quantity: string, selected?: BatchSelection[],
): BatchAllocation[] => {
  const required = batchMilli(quantity);
  if (required <= BigInt(0)) throw new Error('BATCH_QUANTITY_INVALID');
  if (selected !== undefined) {
    const result = selected.map((selection) => {
      const batch = available.find((row) => row.batchId === selection.batchId);
      const amount = batchMilli(selection.quantity);
      if (!batch || amount <= BigInt(0) || amount > batchMilli(batch.quantity)) throw new Error('BATCH_UNAVAILABLE');
      return { batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: formatBatchQuantity(amount) };
    });
    if (new Set(result.map((row) => row.batchId)).size !== result.length
      || result.reduce((sum, row) => sum + batchMilli(row.quantity), BigInt(0)) !== required) throw new Error('BATCH_SELECTION_INVALID');
    return result;
  }
  let remaining = required;
  const result: BatchAllocation[] = [];
  for (const batch of [...available].sort((a, b) => (
    (a.expiryDate ?? '9999-99-99').localeCompare(b.expiryDate ?? '9999-99-99') || a.batchId - b.batchId
  ))) {
    const current = batchMilli(batch.quantity);
    if (current <= BigInt(0)) continue;
    const taken = current < remaining ? current : remaining;
    if (taken > BigInt(0)) result.push({ batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: formatBatchQuantity(taken) });
    remaining -= taken;
    if (remaining === BigInt(0)) break;
  }
  if (remaining !== BigInt(0)) throw new Error('BATCH_UNAVAILABLE');
  return result;
};

export const batchExpiryStatus = (expiryDate: string | null, today: string): 'unknown' | 'expired' | 'soon' | 'valid' => {
  if (expiryDate === null) return 'unknown';
  if (expiryDate < today) return 'expired';
  const threshold = new Date(`${today}T00:00:00Z`);
  threshold.setUTCDate(threshold.getUTCDate() + 30);
  return expiryDate <= threshold.toISOString().slice(0, 10) ? 'soon' : 'valid';
};

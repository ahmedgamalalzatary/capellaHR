'use client';

import { allocateBatchQuantities, batchExpiryStatus, batchMilli, formatBatchQuantity, type BatchSelection, type StockBatch } from '@capella/contracts';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@capella/ui';
import { getProductBatches } from '../api/products-api';

export const batchToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function BatchExpiry({ expiryDate }: { expiryDate: string | null }) {
  const status = batchExpiryStatus(expiryDate, batchToday());
  return <span className={status === 'expired' ? 'text-danger' : status === 'soon' ? 'text-warning' : 'text-muted'}>
    {expiryDate ?? 'الصلاحية غير محددة'}{status === 'expired' ? ' — منتهية الصلاحية' : status === 'soon' ? ' — تنتهي قريباً' : ''}
  </span>;
}

export function BatchPicker({ productId, branchId, quantity, pool = 'stock', packageSize, selected, onChange, available, reserved = [], priorQuantity = '0.000', disabled = false }: {
  productId: number; branchId?: number | undefined; quantity: string;
  pool?: 'stock' | 'consumable' | 'return'; packageSize?: string | undefined;
  selected?: BatchSelection[] | undefined; onChange(value: BatchSelection[] | undefined): void;
  available?: StockBatch[] | undefined; reserved?: BatchSelection[]; priorQuantity?: string;
  disabled?: boolean;
}) {
  const batches = useQuery({ queryKey: ['product-batches', branchId, productId],
    queryFn: () => getProductBatches(productId, branchId === undefined ? {} : { branchId }),
    enabled: productId > 0 && available === undefined,
  });
  const rows = (available ?? batches.data ?? []).map((row) => ({ batchId: row.batchId, expiryDate: row.expiryDate,
    quantity: pool === 'stock' ? `${row.quantity}.000` : pool === 'return' && packageSize
      ? `${batchMilli(row.consumableQuantity) / batchMilli(packageSize)}.000` : row.consumableQuantity,
  })).map((row) => ({ ...row, quantity: formatBatchQuantity(batchMilli(row.quantity)
    - reserved.filter((entry) => entry.batchId === row.batchId).reduce((sum, entry) => sum + batchMilli(entry.quantity), BigInt(0))) }));
  let proposal: typeof rows = [];
  let invalid = false;
  try {
    if (selected === undefined && batchMilli(priorQuantity) > BigInt(0)) {
      const earlier = allocateBatchQuantities(rows, priorQuantity);
      for (const row of rows) row.quantity = formatBatchQuantity(batchMilli(row.quantity)
        - earlier.filter((entry) => entry.batchId === row.batchId).reduce((sum, entry) => sum + batchMilli(entry.quantity), BigInt(0)));
    }
    if (batchMilli(quantity) > BigInt(0)) proposal = allocateBatchQuantities(rows, quantity, selected);
  } catch { invalid = true; }
  if (!productId) return null;
  return <div className="col-span-full space-y-2 text-xs">
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-medium">دفعات الصلاحية</span>
      <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={selected !== undefined}
        onChange={(event) => onChange(event.target.checked ? proposal.map(({ batchId, quantity: amount }) => ({ batchId, quantity: amount })) : undefined)} />اختيار الدفعات يدوياً</label>
    </div>
    {batches.isError && available === undefined ? <p role="alert">تعذر تحميل الدفعات. أعد فتح البند بعد الاتصال.</p> : null}
    {selected !== undefined ? rows.map((batch) => <label key={batch.batchId} className="flex flex-wrap items-center gap-2">
      <span>دفعة #{batch.batchId} · <BatchExpiry expiryDate={batch.expiryDate} /> · متاح {Number(batch.quantity)}</span>
      <Input aria-label={`كمية دفعة ${batch.batchId}`} disabled={disabled} type="number" min="0" max={Math.max(0, Number(batch.quantity))} step={pool === 'consumable' ? '0.001' : '1'}
        className="h-8 w-24" value={selected.find((row) => row.batchId === batch.batchId)?.quantity ?? ''}
        onChange={(event) => { const value = event.target.value;
          const next = selected.filter((row) => row.batchId !== batch.batchId);
          if (/^\d+(?:\.\d{1,3})?$/.test(value) && Number(value) > 0) next.push({ batchId: batch.batchId, quantity: formatBatchQuantity(batchMilli(value)) });
          onChange(next);
        }} />
    </label>) : <p>الأقرب انتهاءً تلقائياً: {proposal.length ? proposal.map((batch) => <span key={batch.batchId} className="me-2">#{batch.batchId} × {Number(batch.quantity)} · <BatchExpiry expiryDate={batch.expiryDate} /></span>) : 'الصلاحية غير محددة'}</p>}
    {proposal.some((batch) => batchExpiryStatus(batch.expiryDate, batchToday()) === 'expired') ? <p role="status" className="text-danger">توجد دفعة منتهية الصلاحية. يمكن متابعة العملية.</p> : null}
    {invalid && (available !== undefined || batches.isSuccess) ? <p role="alert" className="text-danger">راجع كميات الدفعات؛ يجب أن تساوي الكمية المطلوبة وتتوفر في المخزون.</p> : null}
  </div>;
}

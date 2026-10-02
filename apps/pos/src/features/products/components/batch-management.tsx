'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '@capella/ui';
import { notifyError, notifySuccess } from '@/lib/notify';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { getProductBatches, updateProductBatchExpiry, type Product } from '../api/products-api';
import { BatchExpiry } from './batch-picker';

export function BatchManagement({ product, branchId, isAdmin, onClose }: { product: Product; branchId?: number | undefined; isAdmin: boolean; onClose(): void }) {
  const cache = useQueryClient();
  const [dates, setDates] = useState<Record<number, string>>({});
  const query = useQuery({ queryKey: ['product-batches', branchId, product.id],
    queryFn: () => getProductBatches(product.id, branchId === undefined ? {} : { branchId }),
  });
  const save = useMutation({ mutationFn: ({ batchId, expiryDate }: { batchId: number; expiryDate: string | null }) =>
    updateProductBatchExpiry(product.id, batchId, { expiryDate, ...(branchId === undefined ? {} : { branchId }) }),
    onSuccess: async () => {
      notifySuccess('تم تحديث تاريخ الصلاحية.');
      await invalidateErpCaches(cache, 'product');
    }, onError: (error: unknown) => notifyError(error),
  });
  return <Modal title={`دفعات ${product.name}`} className="max-h-[90dvh] overflow-y-auto" onClose={() => { if (!save.isPending) onClose(); }}>
    {isAdmin ? <p className="text-sm text-muted">تعديل الصلاحية يطبق على نفس الدفعة في كل الفروع والمستهلكات. الفواتير السابقة تحتفظ بالصلاحية المسجلة وقت الترحيل.</p> : null}
    {query.isPending ? <p role="status">جارٍ تحميل الدفعات…</p> : query.isError ? <p role="alert">تعذر تحميل الدفعات.</p> : !query.data?.length ? <p>لا توجد دفعات مخزون.</p> : query.data.map((batch) => <div key={batch.batchId} className="space-y-2 rounded-control border border-line p-3">
      <p>دفعة #{batch.batchId} · عبوات {batch.quantity} · مستهلك {batch.consumableQuantity}</p>
      <p><BatchExpiry expiryDate={batch.expiryDate} /></p>
      {isAdmin ? <div className="flex flex-wrap gap-2"><Input type="date" aria-label={`صلاحية الدفعة ${batch.batchId}`} value={dates[batch.batchId] ?? batch.expiryDate ?? ''}
        onChange={(event) => setDates((current) => ({ ...current, [batch.batchId]: event.target.value }))} />
        <Button size="sm" disabled={save.isPending || dates[batch.batchId] === undefined} onClick={() => save.mutate({ batchId: batch.batchId, expiryDate: dates[batch.batchId] || null })}>حفظ الصلاحية</Button></div> : null}
    </div>)}
  </Modal>;
}

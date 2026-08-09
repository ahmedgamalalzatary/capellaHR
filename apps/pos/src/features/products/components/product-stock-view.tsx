'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label } from '@capella/ui';
import { LoadingState } from '@/components/feedback/loading-state';
import { SuccessState } from '@/components/feedback/success-state';

import { listCatalogBranches } from '@/features/catalog';
import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';

import {
  adjustProductStock,
  createProduct,
  listAllProducts,
  listStockMovements,
  updateProduct,
  type Product,
} from '../api/products-api';
import { productQueryKeys } from '../query-keys';

const reasonLabels: Record<string, string> = {
  opening_stock: 'رصيد افتتاحي', count_correction: 'تصحيح جرد', wastage: 'هالك',
  damage: 'تالف', sale: 'بيع', purchase: 'شراء', purchase_cancellation: 'إلغاء شراء', refund: 'مرتجع', void: 'إلغاء بيع',
};
const sourceLabels: Record<string, string> = {
  adjustment: 'تسوية يدوية', sale: 'فاتورة بيع', purchase: 'فاتورة شراء',
  purchase_cancellation: 'إلغاء شراء', refund: 'مرتجع', void: 'إلغاء',
};
const errorText = (value: unknown) => value instanceof ApiError ? value.message : 'تعذر تنفيذ العملية. حاول مرة أخرى.';
const cairoDate = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo',
}).format(new Date(value));

export function ProductStockView() {
  const queryClient = useQueryClient();
  const branches = useQuery({ queryKey: ['product-branches'], queryFn: () => listCatalogBranches() });
  const [branchId, setBranchId] = useState<number>();
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [confirmingToggle, setConfirmingToggle] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('0');
  const [threshold, setThreshold] = useState('0');
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<'count_correction' | 'wastage' | 'damage'>('count_correction');
  const [note, setNote] = useState('');
  const [movementProductId, setMovementProductId] = useState<number>();
  const [movementPage, setMovementPage] = useState(1);
  const [successMessage, setSuccessMessage] = useState<string>();

  const productParams = {
    ...(branchId === undefined ? {} : { branchId }),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(lowStock ? { lowStock: true } : {}),
  };
  const movementParams = {
    ...(branchId === undefined ? {} : { branchId }),
    ...(movementProductId === undefined ? {} : { productId: movementProductId }),
    page: movementPage, pageSize: 20,
  };
  const products = useQuery({ queryKey: productQueryKeys.list(productParams), queryFn: () => listAllProducts(productParams), enabled: branchId !== undefined });
  const movements = useQuery({ queryKey: productQueryKeys.movements(movementParams), queryFn: () => listStockMovements(movementParams), enabled: branchId !== undefined });
  const refresh = () => invalidateErpCaches(queryClient, 'product');
  const clearProductForm = () => { setEditing(null); setName(''); setDescription(''); setPrice(''); setCost('0'); setThreshold('0'); };
  const beginEdit = (product: Product) => { setEditing(product); setName(product.name); setDescription(product.description ?? ''); setPrice(product.sellingPrice); setCost(product.lastPurchaseCost); setThreshold(String(product.lowStockThreshold)); };

  const save = useMutation({
    mutationFn: () => editing
      ? updateProduct(editing.id, { branchId: branchId!, name, description, sellingPrice: price, lastPurchaseCost: cost, lowStockThreshold: Number(threshold) })
      : createProduct({ branchId: branchId!, name, description, sellingPrice: price, lastPurchaseCost: cost, lowStockThreshold: Number(threshold) }),
    onSuccess: async () => { clearProductForm(); setSuccessMessage('تم حفظ المنتج.'); await refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (product: Product) => updateProduct(
      product.id,
      { branchId: branchId!, isActive: !product.isActive },
    ),
    onSuccess: async (_saved, product) => { setConfirmingToggle(null); setSuccessMessage(product.isActive ? 'تم إيقاف المنتج.' : 'تم تفعيل المنتج.'); await refresh(); },
  });
  const adjust = useMutation({
    mutationFn: () => adjustProductStock(adjusting!.id, { branchId: branchId!, quantityDelta: Number(delta), reason, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: async () => { setAdjusting(null); setDelta(''); setNote(''); setSuccessMessage('تم حفظ تسوية المخزون.'); await refresh(); },
  });
  const commandPending = save.isPending || toggle.isPending || adjust.isPending;

  return <div className="mx-auto max-w-7xl space-y-4">
    <div><h1 className="text-xl font-bold">المنتجات والمخزون</h1><p className="text-sm text-muted">إدارة الأسعار والأرصدة وحركات المخزون لكل فرع.</p></div>
    {successMessage ? <SuccessState message={successMessage} /> : null}
    {branches.isError ? <EmptyState title="تعذر تحميل الفروع" action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>} /> : <Label>الفرع<select className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={branchId ?? ''} disabled={commandPending} onChange={(event) => { if (commandPending) return; setBranchId(event.target.value ? Number(event.target.value) : undefined); setEditing(null); setConfirmingToggle(null); setAdjusting(null); setMovementProductId(undefined); setMovementPage(1); }}><option value="">اختر الفرع</option>{branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Label>}
    {branchId === undefined ? <EmptyState title="اختر فرعًا لإدارة مخزونه" /> : <>
      <Card><CardContent className="grid gap-3 pt-5 md:grid-cols-3 xl:grid-cols-6">
        <Input aria-label="اسم المنتج" placeholder="اسم المنتج" disabled={commandPending} value={name} onChange={(event) => setName(event.target.value)} />
        <Input aria-label="وصف المنتج" placeholder="الوصف (اختياري)" disabled={commandPending} value={description} onChange={(event) => setDescription(event.target.value)} />
        <Input aria-label="سعر البيع" placeholder="سعر البيع" disabled={commandPending} value={price} onChange={(event) => setPrice(event.target.value)} />
        <Input aria-label="آخر تكلفة شراء" placeholder="آخر تكلفة شراء" disabled={commandPending} value={cost} onChange={(event) => setCost(event.target.value)} />
        <Input aria-label="حد المخزون المنخفض" type="number" min="0" disabled={commandPending} value={threshold} onChange={(event) => setThreshold(event.target.value)} />
        <div className="flex gap-1"><Button disabled={!name.trim() || !price || commandPending} onClick={() => { if (!commandPending) save.mutate(); }}>{editing ? 'حفظ التعديل' : 'إضافة منتج'}</Button>{editing ? <Button variant="ghost" disabled={commandPending} onClick={clearProductForm}>إلغاء</Button> : null}</div>
        {save.isError ? <p role="alert" className="text-sm text-danger md:col-span-3 xl:col-span-6">{errorText(save.error)}</p> : null}
      </CardContent></Card>
      <div className="flex gap-2"><Input aria-label="بحث في المنتجات" placeholder="بحث" value={search} onChange={(event) => setSearch(event.target.value)} /><Button variant={lowStock ? 'primary' : 'secondary'} onClick={() => setLowStock((value) => !value)}>المخزون المنخفض</Button></div>
      <Card>{products.isPending ? <LoadingState label="جارٍ تحميل المنتجات…" /> : products.isError ? <EmptyState title="تعذر تحميل المنتجات" action={<Button onClick={() => void products.refetch()}>إعادة المحاولة</Button>} /> : !products.data?.items.length ? <EmptyState title="لا توجد منتجات" /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line"><th className="p-3 text-start">المنتج</th><th className="p-3 text-start">السعر</th><th className="p-3 text-start">التكلفة</th><th className="p-3 text-start">الرصيد</th><th className="p-3 text-start">الإجراءات</th></tr></thead><tbody>{products.data.items.map((product) => <tr key={product.id} className="border-b border-line/60"><td className="p-3">{product.name}{product.quantity <= product.lowStockThreshold ? <span className="ms-2 text-danger">منخفض</span> : null}</td><td className="p-3">{product.sellingPrice}</td><td className="p-3">{product.lastPurchaseCost}</td><td className="p-3">{product.quantity}</td><td className="flex flex-wrap gap-1 p-3"><Button size="sm" disabled={commandPending} onClick={() => setAdjusting(product)}>تسوية</Button><Button variant="ghost" size="sm" disabled={commandPending} onClick={() => beginEdit(product)}>تعديل</Button><Button variant="ghost" size="sm" disabled={commandPending} onClick={() => product.isActive ? setConfirmingToggle(product) : toggle.mutate(product)}>{product.isActive ? 'إيقاف' : 'تفعيل'}</Button></td></tr>)}</tbody></table></div>}</Card>
      {toggle.isError ? <p role="alert" className="text-sm text-danger">{errorText(toggle.error)}</p> : null}
      {confirmingToggle ? <ConfirmDialog
        title="إيقاف المنتج"
        description={toggle.isError
          ? errorText(toggle.error)
          : `لن يظهر ${confirmingToggle.name} في المبيعات الجديدة حتى إعادة تفعيله.`}
        confirmLabel="تأكيد إيقاف المنتج"
        tone="danger"
        pending={commandPending}
        onConfirm={() => { if (!commandPending) toggle.mutate(confirmingToggle); }}
        onCancel={() => {
          if (commandPending) return;
          toggle.reset();
          setConfirmingToggle(null);
        }}
      /> : null}
      {adjusting ? <Card><CardContent className="grid gap-3 pt-5 sm:grid-cols-5"><strong>{adjusting.name}</strong><Input aria-label="تغيير الكمية" type="number" disabled={commandPending} value={delta} onChange={(event) => setDelta(event.target.value)} /><select aria-label="سبب التسوية" className="h-10 rounded-control border border-line bg-paper px-3" disabled={commandPending} value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}><option value="count_correction">تصحيح جرد</option><option value="wastage">هالك</option><option value="damage">تالف</option></select><Input aria-label="ملاحظة التسوية" placeholder="ملاحظة" disabled={commandPending} value={note} onChange={(event) => setNote(event.target.value)} /><div className="flex gap-1"><Button disabled={!Number(delta) || commandPending} onClick={() => { if (!commandPending) adjust.mutate(); }}>حفظ</Button><Button variant="ghost" disabled={commandPending} onClick={() => setAdjusting(null)}>إلغاء</Button></div>{adjust.isError ? <p role="alert" className="text-sm text-danger sm:col-span-5">{errorText(adjust.error)}</p> : null}</CardContent></Card> : null}
      <Card><CardContent className="space-y-3 pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">سجل حركات المخزون</h2><select aria-label="تصفية الحركات حسب المنتج" className="h-9 rounded-control border border-line bg-paper px-3" value={movementProductId ?? ''} onChange={(event) => { setMovementProductId(event.target.value ? Number(event.target.value) : undefined); setMovementPage(1); }}><option value="">كل المنتجات</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></div>{movements.isError ? <EmptyState title="تعذر تحميل الحركات" action={<Button onClick={() => void movements.refetch()}>إعادة المحاولة</Button>} /> : movements.isPending ? <LoadingState label="جارٍ تحميل حركات المخزون…" className="p-0 text-start" /> : movements.data?.items.length ? <><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line"><th className="p-2 text-start">المنتج</th><th className="p-2 text-start">السبب</th><th className="p-2 text-start">التغيير/الرصيد</th><th className="p-2 text-start">المصدر</th><th className="p-2 text-start">المنفذ</th><th className="p-2 text-start">الوقت</th></tr></thead><tbody>{movements.data.items.map((movement) => <tr key={movement.id} className="border-b border-line/60"><td className="p-2">{movement.productName}</td><td className="p-2">{reasonLabels[movement.reason] ?? movement.reason}{movement.note ? <span className="block text-xs text-muted">{movement.note}</span> : null}</td><td className="p-2" dir="ltr">{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta} → {movement.balanceAfter}</td><td className="p-2">{sourceLabels[movement.sourceType] ?? movement.sourceType}{movement.sourceId ? ` #${movement.sourceId}` : ''}</td><td className="p-2">{movement.actingUsername}</td><td className="p-2">{cairoDate(movement.createdAt)}</td></tr>)}</tbody></table></div><div className="flex justify-end gap-2"><Button variant="ghost" disabled={movementPage <= 1} onClick={() => setMovementPage((page) => page - 1)}>السابق</Button><span className="self-center text-sm">صفحة {movementPage}</span><Button variant="ghost" disabled={movementPage >= (movements.data.totalPages || 1)} onClick={() => setMovementPage((page) => page + 1)}>التالي</Button></div></> : <p className="text-sm text-muted">لا توجد حركات بعد.</p>}</CardContent></Card>
    </>}
  </div>;
}

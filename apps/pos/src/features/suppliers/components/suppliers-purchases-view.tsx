'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { listCatalogBranches } from '@/features/catalog';
import { listAllProducts, productQueryKeys } from '@/features/products';
import { ApiError } from '@/lib/api/client';
import { createUuid } from '@/lib/uuid';

import {
  cancelPurchase,
  createSupplier,
  listAllSuppliers,
  listPurchases,
  postPurchase,
  updateSupplier,
  type Purchase,
  type Supplier,
} from '../api/suppliers-api';
import { supplierQueryKeys } from '../query-keys';

type DraftLine = { key: number; productId: string; quantity: string; unitCost: string };
const blankLine = (key: number): DraftLine => ({ key, productId: '', quantity: '1', unitCost: '' });
const todayInCairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية. حاول مرة أخرى.';
const cents = (value: string) => /^\d+(?:\.\d{0,2})?$/.test(value)
  ? BigInt(`${value.split('.')[0] || '0'}${(value.split('.')[1] ?? '').padEnd(2, '0')}`)
  : BigInt(0);
const quantityValue = (value: string) => {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= BigInt(2_147_483_647) ? parsed : null;
};
const exactTotal = (lines: DraftLine[]) => {
  const hundred = BigInt(100);
  const total = lines.reduce(
    (sum, line) => sum + cents(line.unitCost) * (quantityValue(line.quantity) ?? BigInt(0)),
    BigInt(0),
  );
  return `${total / hundred}.${String(total % hundred).padStart(2, '0')}`;
};

export function SuppliersPurchasesView() {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<number>();
  const [supplierName, setSupplierName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayInCairo);
  const [lineKey, setLineKey] = useState(2);
  const [lines, setLines] = useState<DraftLine[]>([blankLine(1)]);
  const [idempotencyKey, setIdempotencyKey] = useState(createUuid);
  const [correctionOf, setCorrectionOf] = useState<number>();
  const [page, setPage] = useState(1);
  const [historySupplier, setHistorySupplier] = useState('');
  const [historyProduct, setHistoryProduct] = useState('');
  const [status, setStatus] = useState('');
  const [cancelling, setCancelling] = useState<Purchase | null>(null);
  const [reason, setReason] = useState('');

  const branches = useQuery({ queryKey: ['supplier-branches'], queryFn: () => listCatalogBranches() });
  const supplierParams = { ...(branchId === undefined ? {} : { branchId }), pageSize: 100 };
  const suppliers = useQuery({
    queryKey: supplierQueryKeys.suppliers(supplierParams),
    queryFn: () => listAllSuppliers(supplierParams),
    enabled: branchId !== undefined,
  });
  const activeProductParams = { ...(branchId === undefined ? {} : { branchId }), isActive: true };
  const historyProductParams = branchId === undefined ? {} : { branchId };
  const activeProducts = useQuery({
    queryKey: productQueryKeys.list(activeProductParams),
    queryFn: () => listAllProducts(activeProductParams),
    enabled: branchId !== undefined,
  });
  const historyProducts = useQuery({
    queryKey: productQueryKeys.list(historyProductParams),
    queryFn: () => listAllProducts(historyProductParams),
    enabled: branchId !== undefined,
  });
  const historyParams = {
    ...(branchId === undefined ? {} : { branchId }),
    ...(historySupplier ? { supplierId: Number(historySupplier) } : {}),
    ...(historyProduct ? { productId: Number(historyProduct) } : {}),
    ...(status ? { status } : {}),
    page,
    pageSize: 20,
  };
  const purchases = useQuery({
    queryKey: supplierQueryKeys.purchases(historyParams),
    queryFn: () => listPurchases(historyParams),
    enabled: branchId !== undefined,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: supplierQueryKeys.all });
  const refreshPurchase = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: supplierQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: productQueryKeys.all }),
  ]);
  const clearSupplier = () => {
    setEditing(null); setSupplierName(''); setPhone(''); setNotes('');
  };
  const resetDraft = () => {
    setSupplierId(''); setCorrectionOf(undefined); setLines([blankLine(lineKey)]);
    setIdempotencyKey(createUuid());
    setLineKey((value) => value + 1);
  };
  const changeBranch = (value: string) => {
    setBranchId(value ? Number(value) : undefined);
    clearSupplier(); resetDraft(); setHistorySupplier(''); setHistoryProduct(''); setStatus('');
    setPage(1); setCancelling(null); setReason('');
  };
  const updateLine = (key: number, changes: Partial<DraftLine>) => {
    setIdempotencyKey(createUuid());
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  };
  const beginCorrection = (purchase: Purchase) => {
    setIdempotencyKey(createUuid());
    setCorrectionOf(purchase.id);
    setSupplierId(String(purchase.supplierId));
    setPurchaseDate(todayInCairo());
    setLines(purchase.lines.map((line, index) => ({
      key: lineKey + index,
      productId: String(line.productId),
      quantity: String(line.quantity),
      unitCost: line.unitCost,
    })));
    setLineKey((value) => value + purchase.lines.length);
  };
  const openCancellation = (purchase: Purchase) => { setReason(''); setCancelling(purchase); };
  const closeCancellation = () => { setCancelling(null); setReason(''); };

  const saveSupplier = useMutation({
    mutationFn: () => editing
      ? updateSupplier(editing.id, { branchId: branchId!, name: supplierName, phone, notes })
      : createSupplier({
          branchId: branchId!, name: supplierName,
          ...(phone.trim() ? { phone: phone.trim() } : {}), notes,
        }),
    onSuccess: async () => { clearSupplier(); await refresh(); },
  });
  const toggleSupplier = useMutation({
    mutationFn: (supplier: Supplier) => updateSupplier(
      supplier.id,
      { branchId: branchId!, isActive: !supplier.isActive },
    ),
    onSuccess: async (_updated, supplier) => {
      if (supplier.isActive && supplierId === String(supplier.id)) {
        resetDraft();
      }
      await refresh();
    },
  });
  const post = useMutation({
    mutationFn: () => postPurchase({
      branchId: branchId!, idempotencyKey, supplierId: Number(supplierId), purchaseDate,
      lines: lines.map((line) => ({
        productId: Number(line.productId), quantity: Number(line.quantity), unitCost: line.unitCost,
      })),
      ...(correctionOf === undefined ? {} : { correctsPurchaseId: correctionOf }),
    }),
    onSuccess: async () => { resetDraft(); await refreshPurchase(); },
  });
  const cancel = useMutation({
    mutationFn: () => cancelPurchase(cancelling!.id, { branchId: branchId!, reason }),
    onSuccess: async () => { closeCancellation(); await refreshPurchase(); },
  });
  const validLines = lines.length > 0 && lines.every((line) => (
    Number(line.productId) && quantityValue(line.quantity) !== null && cents(line.unitCost) > BigInt(0)
  ));
  const activeSuppliers = suppliers.data?.items.filter((supplier) => supplier.isActive) ?? [];

  return <div className="mx-auto max-w-7xl space-y-4">
    <div>
      <h1 className="text-xl font-bold">الموردون والمشتريات</h1>
      <p className="text-sm text-muted">ترحيل مشتريات مدفوعة بالكامل إلى المخزون مع سجل غير قابل للتعديل.</p>
    </div>
    {branches.isError
      ? <EmptyState title="تعذر تحميل الفروع" action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>} />
      : <Label>الفرع<select className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={branchId ?? ''} onChange={(event) => changeBranch(event.target.value)}><option value="">اختر الفرع</option>{branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Label>}
    {branchId === undefined ? <EmptyState title="اختر فرعاً لإدارة الموردين والمشتريات" /> : <>
      <Card><CardContent className="space-y-3 pt-5">
        <h2 className="font-semibold">إدارة الموردين</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <Input aria-label="اسم المورد" placeholder="اسم المورد" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
          <Input aria-label="هاتف المورد" placeholder="الهاتف (اختياري)" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <Input aria-label="ملاحظات المورد" placeholder="ملاحظات" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="flex gap-1"><Button disabled={!supplierName.trim() || saveSupplier.isPending} onClick={() => saveSupplier.mutate()}>{editing ? 'حفظ المورد' : 'إضافة المورد'}</Button>{editing ? <Button variant="ghost" onClick={clearSupplier}>إلغاء</Button> : null}</div>
        </div>
        {saveSupplier.isError ? <p role="alert" className="text-danger">{errorText(saveSupplier.error)}</p> : null}
        {suppliers.isError ? <EmptyState title="تعذر تحميل الموردين" action={<Button onClick={() => void suppliers.refetch()}>إعادة المحاولة</Button>} />
          : suppliers.isPending ? <p className="text-sm text-muted">جارٍ تحميل الموردين…</p>
          : !suppliers.data.items.length ? <EmptyState title="لا يوجد موردون بعد" />
          : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-start">المورد</th><th className="p-2 text-start">الهاتف</th><th className="p-2 text-start">الحالة</th><th className="p-2 text-start">الإجراءات</th></tr></thead><tbody>{suppliers.data.items.map((supplier) => <tr key={supplier.id} className="border-t border-line"><td className="p-2">{supplier.name}</td><td className="p-2">{supplier.phone ?? '—'}</td><td className="p-2">{supplier.isActive ? 'نشط' : 'متوقف'}</td><td className="p-2"><Button size="sm" variant="ghost" onClick={() => { setEditing(supplier); setSupplierName(supplier.name); setPhone(supplier.phone ?? ''); setNotes(supplier.notes ?? ''); }}>تعديل</Button><Button size="sm" variant="ghost" disabled={toggleSupplier.isPending} onClick={() => toggleSupplier.mutate(supplier)}>{supplier.isActive ? 'إيقاف' : 'تفعيل'}</Button></td></tr>)}</tbody></table></div>}
        {toggleSupplier.isError ? <p role="alert" className="text-danger">{errorText(toggleSupplier.error)}</p> : null}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-5">
        <h2 className="font-semibold">{correctionOf === undefined ? 'ترحيل مشتريات جديدة' : `تصحيح للمشتريات #${correctionOf}`}</h2>
        {suppliers.isError || activeProducts.isError ? <EmptyState title="تعذر تحميل خيارات المشتريات" action={<Button onClick={() => { void suppliers.refetch(); void activeProducts.refetch(); }}>إعادة المحاولة</Button>} /> : suppliers.isPending || activeProducts.isPending ? <p className="text-sm text-muted">جارٍ تحميل خيارات المشتريات…</p> : <>
          <div className="grid gap-2 md:grid-cols-2">
            <Label>المورد للمشتريات<select className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={supplierId} onChange={(event) => { setIdempotencyKey(createUuid()); setSupplierId(event.target.value); }}><option value="">اختر المورد</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Label>
            <Label>تاريخ المشتريات<Input type="date" value={purchaseDate} onChange={(event) => { setIdempotencyKey(createUuid()); setPurchaseDate(event.target.value); }} /></Label>
          </div>
          {lines.map((line, index) => <div key={line.key} className="grid gap-2 md:grid-cols-4">
            <Label>المنتج<select className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={line.productId} onChange={(event) => updateLine(line.key, { productId: event.target.value })}><option value="">اختر المنتج</option>{activeProducts.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Label>
            <Label>الكمية<Input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></Label>
            <Label>تكلفة الوحدة<Input inputMode="decimal" value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} /></Label>
            <Button variant="ghost" disabled={lines.length === 1} onClick={() => { setIdempotencyKey(createUuid()); setLines((current) => current.filter((entry) => entry.key !== line.key)); }}>حذف البند {index + 1}</Button>
          </div>)}
          <Button variant="ghost" onClick={() => { setIdempotencyKey(createUuid()); setLines((current) => [...current, blankLine(lineKey)]); setLineKey((value) => value + 1); }}>إضافة بند</Button>
          <p className="font-semibold">الإجمالي: {exactTotal(lines)} ج.م</p>
          <div className="flex gap-2"><Button disabled={!supplierId || !purchaseDate || !validLines || post.isPending} onClick={() => post.mutate()}>{correctionOf === undefined ? 'ترحيل المشتريات' : 'ترحيل التصحيح'}</Button>{correctionOf !== undefined ? <Button variant="ghost" onClick={resetDraft}>إلغاء التصحيح</Button> : null}</div>
          {post.isError ? <p role="alert" className="text-danger">{errorText(post.error)}</p> : null}
        </>}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-5">
        <h2 className="font-semibold">سجل المشتريات</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <select aria-label="تصفية حسب المورد" className="h-10 rounded-control border border-line bg-paper px-3" value={historySupplier} onChange={(event) => { setHistorySupplier(event.target.value); setPage(1); }}><option value="">كل الموردين</option>{suppliers.data?.items.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
          <select aria-label="تصفية حسب المنتج" className="h-10 rounded-control border border-line bg-paper px-3" value={historyProduct} onChange={(event) => { setHistoryProduct(event.target.value); setPage(1); }}><option value="">كل المنتجات</option>{historyProducts.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
          <select aria-label="تصفية حسب الحالة" className="h-10 rounded-control border border-line bg-paper px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option><option value="posted">مُرحّلة</option><option value="cancelled">ملغاة</option></select>
        </div>
        {purchases.isError ? <EmptyState title="تعذر تحميل سجل المشتريات" action={<Button onClick={() => void purchases.refetch()}>إعادة المحاولة</Button>} />
          : purchases.isPending ? <p className="text-sm text-muted">جارٍ تحميل سجل المشتريات…</p>
          : !purchases.data.items.length ? <EmptyState title="لا توجد مشتريات بعد" />
          : <><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-start">الرقم</th><th className="p-2 text-start">المورد</th><th className="p-2 text-start">البنود</th><th className="p-2 text-start">الإجمالي</th><th className="p-2 text-start">الحالة</th><th className="p-2 text-start">الإجراء</th></tr></thead><tbody>{purchases.data.items.map((purchase) => <tr key={purchase.id} className="border-t border-line"><td className="p-2">#{purchase.id}</td><td className="p-2">{purchase.supplierName}<span className="block text-xs text-muted">{purchase.purchaseDate}</span></td><td className="p-2">{purchase.lines.map((line) => <span key={line.id} className="block">{line.productNameSnapshot}: {line.quantity} × {line.unitCost} = {line.lineTotal}</span>)}</td><td className="p-2">{purchase.total} ج.م</td><td className="p-2">{purchase.status === 'posted' ? 'مُرحّلة' : `ملغاة — ${purchase.cancellationReason}`}{purchase.correctsPurchaseId ? <span className="block text-xs">تصحيح للمشتريات #{purchase.correctsPurchaseId}</span> : null}{purchase.correctedByPurchaseId ? <span className="block text-xs">صُححت بالمشتريات #{purchase.correctedByPurchaseId}</span> : null}</td><td className="p-2">{purchase.status === 'posted' ? <Button size="sm" variant="danger" onClick={() => openCancellation(purchase)}>إلغاء المشتريات</Button> : purchase.correctedByPurchaseId === null ? <Button size="sm" variant="ghost" onClick={() => beginCorrection(purchase)}>إنشاء تصحيح</Button> : 'غير قابلة للتعديل'}</td></tr>)}</tbody></table></div><div className="flex justify-end gap-2"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span>صفحة {page}</span><Button variant="ghost" disabled={page >= purchases.data.meta.totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button></div></>}
      </CardContent></Card>

      {purchases.data?.items.length ? <Card><CardContent className="space-y-2 pt-5"><h2 className="font-semibold">نتائج المخزون</h2>{purchases.data.items.flatMap((purchase) => purchase.lines.map((line) => <p key={`${purchase.id}-${line.id}`} className="text-sm">مشتريات #{purchase.id} — {line.productNameSnapshot}: الرصيد بعد الترحيل: {line.postedBalanceAfter ?? 'غير متاح'}{line.cancellationBalanceAfter === null ? '' : `، وبعد الإلغاء ${line.cancellationBalanceAfter}`}</p>))}</CardContent></Card> : null}

      {cancelling ? <Card><CardContent className="space-y-2 pt-5"><h2 className="font-semibold">إلغاء المشتريات #{cancelling.id}</h2><p className="text-sm text-danger">سيُعكس المخزون فقط إذا كانت الكميات الحالية كافية. السجل الأصلي سيظل محفوظاً.</p><Input aria-label="سبب الإلغاء" value={reason} onChange={(event) => setReason(event.target.value)} /><div className="flex gap-2"><Button variant="danger" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>تأكيد الإلغاء</Button><Button variant="ghost" onClick={closeCancellation}>رجوع</Button></div>{cancel.isError ? <p role="alert" className="text-danger">{errorText(cancel.error)}</p> : null}</CardContent></Card> : null}
    </>}
  </div>;
}

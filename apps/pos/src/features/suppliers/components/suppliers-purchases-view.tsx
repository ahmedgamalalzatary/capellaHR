'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label, Modal } from '@capella/ui';

import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { DraftNotice } from '@/components/feedback/draft-notice';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { SuccessState } from '@/components/feedback/success-state';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { listCatalogBranches } from '@/features/catalog';
import { listAllProducts, productQueryKeys } from '@/features/products';
import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { useFormDraft } from '@/lib/form-draft';
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
  /**
   * A cashier runs the suppliers and purchases of their own branch: the server pins every
   * request to the branch of their account, so only an admin picks which branch to work on.
   */
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const [selectedBranchId, setSelectedBranchId] = useState<number>();
  const branchId = isAdmin ? selectedBranchId : undefined;
  const scopeReady = session.isSuccess && (!isAdmin || selectedBranchId !== undefined);
  const [supplierName, setSupplierName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [confirmingToggle, setConfirmingToggle] = useState<Supplier | null>(null);
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
  const [successMessage, setSuccessMessage] = useState<string>();

  const branches = useQuery({
    queryKey: ['supplier-branches'],
    queryFn: () => listCatalogBranches(),
    enabled: isAdmin,
  });
  const branchScope = branchId === undefined ? {} : { branchId };
  const supplierParams = { ...branchScope, pageSize: 100 };
  const suppliers = useQuery({
    queryKey: supplierQueryKeys.suppliers(supplierParams),
    queryFn: () => listAllSuppliers(supplierParams),
    enabled: scopeReady,
  });
  const activeProductParams = { ...(branchId === undefined ? {} : { branchId }), isActive: true };
  const historyProductParams = branchId === undefined ? {} : { branchId };
  const activeProducts = useQuery({
    queryKey: productQueryKeys.list(activeProductParams),
    queryFn: () => listAllProducts(activeProductParams),
    enabled: scopeReady,
  });
  const historyProducts = useQuery({
    queryKey: productQueryKeys.list(historyProductParams),
    queryFn: () => listAllProducts(historyProductParams),
    enabled: scopeReady,
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
    enabled: scopeReady,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: supplierQueryKeys.all });
  const refreshPurchase = () => invalidateErpCaches(queryClient, 'purchase');
  const clearSupplier = () => {
    setEditing(null); setSupplierName(''); setPhone(''); setNotes('');
  };
  const resetDraft = () => {
    setSupplierId(''); setCorrectionOf(undefined); setLines([blankLine(lineKey)]);
    setPurchaseDate(todayInCairo());
    setIdempotencyKey(createUuid());
    setLineKey((value) => value + 1);
  };
  /** Two separate workbenches on one screen, so each keeps its own memory. */
  const supplierDraft = useFormDraft(
    editing === null ? `supplier:${branchId ?? 'own'}` : null,
    { supplierName, phone, notes },
    supplierName.trim() !== '' || phone.trim() !== '' || notes.trim() !== '',
  );
  const purchaseDraft = useFormDraft(
    correctionOf === undefined ? `purchase:${branchId ?? 'own'}` : null,
    { supplierId, purchaseDate, lines },
    supplierId !== '' || lines.some((line) => line.productId !== '' || line.unitCost !== ''),
  );

  const changeBranch = (value: string) => {
    if (saveSupplier.isPending || toggleSupplier.isPending || post.isPending || cancel.isPending) return;
    setSelectedBranchId(value ? Number(value) : undefined);
    clearSupplier(); resetDraft(); setHistorySupplier(''); setHistoryProduct(''); setStatus('');
    setPage(1); setConfirmingToggle(null); setCancelling(null); setReason('');
  };
  const updateLine = (key: number, changes: Partial<DraftLine>) => {
    if (commandPending) return;
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
      ? updateSupplier(editing.id, { ...branchScope, name: supplierName, phone, notes })
      : createSupplier({
          ...branchScope, name: supplierName,
          ...(phone.trim() ? { phone: phone.trim() } : {}), notes,
        }),
    onSuccess: async () => { supplierDraft.clear(); clearSupplier(); setSuccessMessage('تم حفظ المورد.'); await refresh(); },
  });
  const toggleSupplier = useMutation({
    mutationFn: (supplier: Supplier) => updateSupplier(
      supplier.id,
      { ...branchScope, isActive: !supplier.isActive },
    ),
    onSuccess: async (_updated, supplier) => {
      setConfirmingToggle(null);
      if (supplier.isActive && supplierId === String(supplier.id)) {
        resetDraft();
      }
      setSuccessMessage(supplier.isActive ? 'تم إيقاف المورد.' : 'تم تفعيل المورد.');
      await refresh();
    },
  });
  const post = useMutation({
    mutationFn: () => postPurchase({
      ...branchScope, idempotencyKey, supplierId: Number(supplierId), purchaseDate,
      lines: lines.map((line) => ({
        productId: Number(line.productId), quantity: Number(line.quantity), unitCost: line.unitCost,
      })),
      ...(correctionOf === undefined ? {} : { correctsPurchaseId: correctionOf }),
    }),
    onSuccess: async () => { purchaseDraft.clear(); resetDraft(); setSuccessMessage('تم ترحيل المشتريات إلى المخزون.'); await refreshPurchase(); },
  });
  const cancel = useMutation({
    mutationFn: () => cancelPurchase(cancelling!.id, { ...branchScope, reason }),
    onSuccess: async () => { closeCancellation(); setSuccessMessage('تم إلغاء المشتريات وعكس أثر المخزون.'); await refreshPurchase(); },
  });
  const validLines = lines.length > 0 && lines.every((line) => (
    Number(line.productId) && quantityValue(line.quantity) !== null && cents(line.unitCost) > BigInt(0)
  ));
  const activeSuppliers = suppliers.data?.items.filter((supplier) => supplier.isActive) ?? [];
  const commandPending = saveSupplier.isPending || toggleSupplier.isPending || post.isPending || cancel.isPending;

  return (
    <section className="space-y-6">
      <PageHeader
        title="الموردون والمشتريات"
        description="ترحيل مشتريات مدفوعة بالكامل إلى المخزون مع سجل غير قابل للتعديل."
      />
      {successMessage ? <SuccessState message={successMessage} /> : null}

      {isAdmin ? (
        <Card className="shadow-card">
          <CardContent className="p-4 sm:p-5">
            {branches.isError ? (
              <EmptyState
                title="تعذر تحميل الفروع"
                className="py-8"
                action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>}
              />
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="supplier-branch">الفرع</Label>
                <Select
                  id="supplier-branch"
                  className="max-w-sm"
                  value={selectedBranchId ?? ''}
                  disabled={commandPending}
                  onChange={(event) => changeBranch(event.target.value)}
                >
                  <option value="">اختر الفرع</option>
                  {branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!scopeReady ? (
        <Card className="shadow-card">
          {isAdmin
            ? <EmptyState title="اختر فرعاً لإدارة الموردين والمشتريات" />
            : <LoadingState label="جارٍ التحقق من الجلسة…" className="py-16" />}
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden shadow-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeading
                title="إدارة الموردين"
                description="المورد الموقوف يبقى في السجل ولا يظهر في مشتريات جديدة."
              />
              {supplierDraft.pending ? (
                <DraftNotice
                  onRestore={() => {
                    const stored = supplierDraft.restore();
                    if (!stored) return;
                    setSupplierName(stored.supplierName);
                    setPhone(stored.phone);
                    setNotes(stored.notes);
                  }}
                  onDiscard={supplierDraft.discard}
                />
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-name">اسم المورد</Label>
                  <Input id="supplier-name" aria-label="اسم المورد" placeholder="اسم المورد" disabled={commandPending} value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-phone">هاتف المورد</Label>
                  <Input id="supplier-phone" aria-label="هاتف المورد" placeholder="الهاتف (اختياري)" className="text-start" disabled={commandPending} value={phone} onChange={(event) => setPhone(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-notes">ملاحظات المورد</Label>
                  <Input id="supplier-notes" aria-label="ملاحظات المورد" placeholder="ملاحظات" disabled={commandPending} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </div>
                <div className="flex items-end gap-2">
                  <Button disabled={!supplierName.trim() || commandPending} onClick={() => { if (!commandPending) saveSupplier.mutate(); }}>
                    {editing ? 'حفظ المورد' : 'إضافة المورد'}
                  </Button>
                  {editing ? <Button variant="ghost" disabled={commandPending} onClick={clearSupplier}>إلغاء</Button> : null}
                </div>
              </div>
              {saveSupplier.isError ? <FieldError>{errorText(saveSupplier.error)}</FieldError> : null}
              {toggleSupplier.isError ? <FieldError>{errorText(toggleSupplier.error)}</FieldError> : null}
            </CardContent>

            {suppliers.isError ? (
              <EmptyState title="تعذر تحميل الموردين" action={<Button onClick={() => void suppliers.refetch()}>إعادة المحاولة</Button>} />
            ) : suppliers.isPending ? (
              <LoadingState label="جارٍ تحميل الموردين…" className="py-16" />
            ) : !suppliers.data.items.length ? (
              <EmptyState title="لا يوجد موردون بعد" />
            ) : (
              <DataTable className="border-t border-line/70">
                <THead>
                  <TH>المورد</TH>
                  <TH>الهاتف</TH>
                  <TH>الحالة</TH>
                  <TH>الإجراءات</TH>
                </THead>
                <tbody>
                  {suppliers.data.items.map((supplier) => (
                    <TR key={supplier.id}>
                      <TD className="font-medium">{supplier.name}</TD>
                      <TD className="tabular text-muted">{supplier.phone ?? '—'}</TD>
                      <TD>
                        <Badge variant={supplier.isActive ? 'success' : 'neutral'}>
                          {supplier.isActive ? 'نشط' : 'متوقف'}
                        </Badge>
                      </TD>
                      <TD>
                        <RowActions>
                          <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => { setEditing(supplier); setSupplierName(supplier.name); setPhone(supplier.phone ?? ''); setNotes(supplier.notes ?? ''); }}>تعديل</Button>
                          <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => supplier.isActive ? setConfirmingToggle(supplier) : toggleSupplier.mutate(supplier)}>
                            {supplier.isActive ? 'إيقاف' : 'تفعيل'}
                          </Button>
                        </RowActions>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>

          <Card className="shadow-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeading
                title={correctionOf === undefined ? 'ترحيل مشتريات جديدة' : `تصحيح للمشتريات #${correctionOf}`}
                description="المشتريات مدفوعة بالكامل عند الترحيل، ولا تُعدَّل بعده إلا بتصحيح جديد."
              />
              {purchaseDraft.pending ? (
                <DraftNotice
                  onRestore={() => {
                    const stored = purchaseDraft.restore();
                    if (!stored) return;
                    setSupplierId(stored.supplierId);
                    setPurchaseDate(stored.purchaseDate);
                    setLines(stored.lines);
                    setLineKey(Math.max(...stored.lines.map((line) => line.key), 0) + 1);
                  }}
                  onDiscard={purchaseDraft.discard}
                />
              ) : null}
              {suppliers.isError || activeProducts.isError ? (
                <EmptyState title="تعذر تحميل خيارات المشتريات" className="py-8" action={<Button onClick={() => { void suppliers.refetch(); void activeProducts.refetch(); }}>إعادة المحاولة</Button>} />
              ) : suppliers.isPending || activeProducts.isPending ? (
                <LoadingState label="جارٍ تحميل خيارات المشتريات…" className="py-10" />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="purchase-supplier">المورد للمشتريات</Label>
                      <Select
                        id="purchase-supplier"
                        value={supplierId}
                        disabled={commandPending}
                        onChange={(event) => { if (commandPending) return; setIdempotencyKey(createUuid()); setSupplierId(event.target.value); }}
                      >
                        <option value="">اختر المورد</option>
                        {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="purchase-date">تاريخ المشتريات</Label>
                      <Input id="purchase-date" type="date" disabled={commandPending} value={purchaseDate} onChange={(event) => { if (commandPending) return; setIdempotencyKey(createUuid()); setPurchaseDate(event.target.value); }} />
                    </div>
                  </div>

                  <ul className="space-y-3">
                    {lines.map((line, index) => (
                      <li key={line.key} className="rounded-control border border-line bg-surface/50 p-3">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_auto] xl:items-end">
                          <div className="space-y-1.5">
                            <Label htmlFor={`purchase-product-${line.key}`}>المنتج</Label>
                            <Select
                              id={`purchase-product-${line.key}`}
                              value={line.productId}
                              disabled={commandPending}
                              onChange={(event) => { if (!commandPending) updateLine(line.key, { productId: event.target.value }); }}
                            >
                              <option value="">اختر المنتج</option>
                              {activeProducts.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`purchase-quantity-${line.key}`}>الكمية</Label>
                            <Input id={`purchase-quantity-${line.key}`} type="number" min="1" className="text-start" disabled={commandPending} value={line.quantity} onChange={(event) => { if (!commandPending) updateLine(line.key, { quantity: event.target.value }); }} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`purchase-cost-${line.key}`}>تكلفة الوحدة</Label>
                            <Input id={`purchase-cost-${line.key}`} inputMode="decimal" className="text-start" disabled={commandPending} value={line.unitCost} onChange={(event) => { if (!commandPending) updateLine(line.key, { unitCost: event.target.value }); }} />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`حذف البند ${index + 1}`}
                            disabled={commandPending || lines.length === 1}
                            onClick={() => { if (commandPending) return; setIdempotencyKey(createUuid()); setLines((current) => current.filter((entry) => entry.key !== line.key)); }}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            <span className="xl:sr-only">حذف البند {index + 1}</span>
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4">
                    <Button variant="secondary" size="sm" disabled={commandPending} onClick={() => { if (commandPending) return; setIdempotencyKey(createUuid()); setLines((current) => [...current, blankLine(lineKey)]); setLineKey((value) => value + 1); }}>
                      <Plus className="size-4" aria-hidden />
                      إضافة بند
                    </Button>
                    <p className="tabular text-base font-semibold text-ink">الإجمالي: {exactTotal(lines)} ج.م</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!supplierId || !purchaseDate || !validLines || commandPending} onClick={() => { if (!commandPending) post.mutate(); }}>
                      {correctionOf === undefined ? 'ترحيل المشتريات' : 'ترحيل التصحيح'}
                    </Button>
                    {correctionOf !== undefined ? <Button variant="ghost" disabled={commandPending} onClick={resetDraft}>إلغاء التصحيح</Button> : null}
                  </div>
                  {post.isError ? <FieldError>{errorText(post.error)}</FieldError> : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeading title="سجل المشتريات" />
              <div className="grid gap-3 sm:grid-cols-3">
                <Select aria-label="تصفية حسب المورد" value={historySupplier} onChange={(event) => { setHistorySupplier(event.target.value); setPage(1); }}>
                  <option value="">كل الموردين</option>
                  {suppliers.data?.items.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </Select>
                <Select aria-label="تصفية حسب المنتج" value={historyProduct} onChange={(event) => { setHistoryProduct(event.target.value); setPage(1); }}>
                  <option value="">كل المنتجات</option>
                  {historyProducts.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </Select>
                <Select aria-label="تصفية حسب الحالة" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                  <option value="">كل الحالات</option>
                  <option value="posted">مُرحّلة</option>
                  <option value="cancelled">ملغاة</option>
                </Select>
              </div>
            </CardContent>

            {purchases.isError ? (
              <EmptyState title="تعذر تحميل سجل المشتريات" action={<Button onClick={() => void purchases.refetch()}>إعادة المحاولة</Button>} />
            ) : purchases.isPending ? (
              <LoadingState label="جارٍ تحميل سجل المشتريات…" className="py-16" />
            ) : !purchases.data.items.length ? (
              <EmptyState title="لا توجد مشتريات بعد" />
            ) : (
              <>
                <DataTable className="border-t border-line/70">
                  <THead>
                    <TH>الرقم</TH>
                    <TH>المورد</TH>
                    <TH>البنود</TH>
                    <TH numeric>الإجمالي</TH>
                    <TH>الحالة</TH>
                    <TH>الإجراء</TH>
                  </THead>
                  <tbody>
                    {purchases.data.items.map((purchase) => (
                      <TR key={purchase.id}>
                        <TD className="tabular text-muted">#{purchase.id}</TD>
                        <TD>
                          <span className="block font-medium">{purchase.supplierName}</span>
                          <span className="block text-xs text-muted">{purchase.purchaseDate}</span>
                        </TD>
                        <TD>
                          {purchase.lines.map((line) => (
                            <span key={line.id} className="block text-[13px]">
                              {line.productNameSnapshot}: {line.quantity} × {line.unitCost} = {line.lineTotal}
                            </span>
                          ))}
                        </TD>
                        <TD numeric className="whitespace-nowrap font-medium">{purchase.total} ج.م</TD>
                        <TD>
                          {purchase.status === 'posted' ? (
                            <Badge variant="success">مُرحّلة</Badge>
                          ) : (
                            <span className="text-[13px] text-danger">{`ملغاة — ${purchase.cancellationReason}`}</span>
                          )}
                          {purchase.correctsPurchaseId ? <span className="mt-1 block text-xs text-muted">تصحيح للمشتريات #{purchase.correctsPurchaseId}</span> : null}
                          {purchase.correctedByPurchaseId ? <span className="mt-1 block text-xs text-muted">صُححت بالمشتريات #{purchase.correctedByPurchaseId}</span> : null}
                        </TD>
                        <TD>
                          {purchase.status === 'posted' ? (
                            <Button size="sm" variant="danger" disabled={commandPending} onClick={() => openCancellation(purchase)}>إلغاء المشتريات</Button>
                          ) : purchase.correctedByPurchaseId === null ? (
                            <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => beginCorrection(purchase)}>إنشاء تصحيح</Button>
                          ) : (
                            <span className="text-[13px] text-muted">غير قابلة للتعديل</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </DataTable>
                <Pagination
                  summary={<>صفحة <span className="tabular">{page}</span></>}
                  previousDisabled={page <= 1}
                  nextDisabled={page >= purchases.data.meta.totalPages}
                  onPrevious={() => setPage((value) => value - 1)}
                  onNext={() => setPage((value) => value + 1)}
                />
              </>
            )}
          </Card>

          {purchases.data?.items.length ? (
            <Card className="shadow-card">
              <CardContent className="space-y-2 p-4 sm:p-5">
                <SectionHeading title="نتائج المخزون" />
                <ul className="space-y-1">
                  {purchases.data.items.flatMap((purchase) => purchase.lines.map((line) => (
                    <li key={`${purchase.id}-${line.id}`} className="text-[13px] text-muted">
                      مشتريات #{purchase.id} — {line.productNameSnapshot}: الرصيد بعد الترحيل: {line.postedBalanceAfter ?? 'غير متاح'}{line.cancellationBalanceAfter === null ? '' : `، وبعد الإلغاء ${line.cancellationBalanceAfter}`}
                    </li>
                  )))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {confirmingToggle ? <ConfirmDialog
            title="إيقاف المورد"
            description={toggleSupplier.isError
              ? errorText(toggleSupplier.error)
              : `لن يكون ${confirmingToggle.name} متاحاً للمشتريات الجديدة حتى إعادة تفعيله.`}
            confirmLabel="تأكيد إيقاف المورد"
            tone="danger"
            pending={commandPending}
            onConfirm={() => { if (!commandPending) toggleSupplier.mutate(confirmingToggle); }}
            onCancel={() => {
              if (commandPending) return;
              toggleSupplier.reset();
              setConfirmingToggle(null);
            }}
          /> : null}

          {cancelling ? <Modal
            title={`إلغاء المشتريات #${cancelling.id}`}
            dismissOnBackdrop={!commandPending}
            onClose={() => { if (!commandPending) closeCancellation(); }}
          >
            <p className="text-[13px] text-muted">سيُعكس المخزون فقط إذا كانت الكميات الحالية كافية. السجل الأصلي سيظل محفوظاً.</p>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">سبب الإلغاء</Label>
              <Input id="cancel-reason" aria-label="سبب الإلغاء" disabled={commandPending} value={reason} onChange={(event) => { if (!commandPending) setReason(event.target.value); }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" size="sm" disabled={!reason.trim() || commandPending} onClick={() => { if (!commandPending) cancel.mutate(); }}>تأكيد الإلغاء</Button>
              <Button variant="ghost" size="sm" disabled={commandPending} onClick={() => { if (!commandPending) closeCancellation(); }}>رجوع</Button>
            </div>
            {cancel.isError ? <FieldError>{errorText(cancel.error)}</FieldError> : null}
          </Modal> : null}
        </>
      )}
    </section>
  );
}

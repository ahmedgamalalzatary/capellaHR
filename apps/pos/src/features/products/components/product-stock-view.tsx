'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

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
import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { useFormDraft } from '@/lib/form-draft';

import {
  adjustProductStock,
  createProduct,
  generateProductBarcode,
  listAllProducts,
  listStockMovements,
  updateProduct,
  type Product,
} from '../api/products-api';
import { productQueryKeys } from '../query-keys';
import { ProductLabelSheet } from './product-label-sheet';

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
  /**
   * A cashier manages the products of their own branch: the server pins every request to the
   * branch of their account, so only an admin picks which branch to work on.
   */
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const branches = useQuery({
    queryKey: ['product-branches'],
    queryFn: () => listCatalogBranches(),
    enabled: isAdmin,
  });
  const [selectedBranchId, setSelectedBranchId] = useState<number | undefined>(() => {
    if (typeof sessionStorage === 'undefined') return undefined;
    const stored = sessionStorage.getItem('capella:pos-admin-branch');
    const parsed = stored ? Number(stored) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  });
  const [createOpen, setCreateOpen] = useState(false);
  const branchId = isAdmin ? selectedBranchId : undefined;
  const scopeReady = session.isSuccess && (!isAdmin || selectedBranchId !== undefined);
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [confirmingToggle, setConfirmingToggle] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('0');
  const [commissionPercent, setCommissionPercent] = useState('0');
  const [threshold, setThreshold] = useState('0');
  const [barcode, setBarcode] = useState('');
  const [labelling, setLabelling] = useState<Product | null>(null);
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
  const products = useQuery({ queryKey: productQueryKeys.list(productParams), queryFn: () => listAllProducts(productParams), enabled: scopeReady });
  const catalogProducts = useQuery({
    queryKey: productQueryKeys.list({ ...(branchId === undefined ? {} : { branchId }), catalog: true }),
    queryFn: () => listAllProducts(branchId === undefined ? {} : { branchId }),
    enabled: scopeReady,
  });
  const movements = useQuery({ queryKey: productQueryKeys.movements(movementParams), queryFn: () => listStockMovements(movementParams), enabled: scopeReady });
  const refresh = () => invalidateErpCaches(queryClient, 'product');
  const clearProductForm = () => {
    setEditing(null);
    setCreateOpen(false);
    setName(''); setDescription(''); setPrice(''); setCost('0'); setCommissionPercent('0'); setThreshold('0'); setBarcode('');
  };
  const beginEdit = (product: Product) => {
    setCreateOpen(false);
    setAdjusting(null);
    setEditing(product);
    setName(product.name);
    setDescription(product.description ?? '');
    setPrice(product.sellingPrice);
    setCost(product.lastPurchaseCost);
    setCommissionPercent(product.commissionPercent ?? '0');
    setThreshold(String(product.lowStockThreshold));
    setBarcode(product.barcode ?? '');
  };
  const formOpen = createOpen || editing !== null;

  useEffect(() => {
    if (!isAdmin) return;
    if (selectedBranchId === undefined) {
      sessionStorage.removeItem('capella:pos-admin-branch');
      return;
    }
    sessionStorage.setItem('capella:pos-admin-branch', String(selectedBranchId));
  }, [isAdmin, selectedBranchId]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  /** A new product only: editing starts from a stored row. */
  const draft = useFormDraft(
    editing === null && createOpen ? `product:${branchId ?? 'own'}` : null,
    { name, description, price, cost, commissionPercent, threshold, barcode },
    name.trim() !== '' || description.trim() !== '' || price.trim() !== '',
  );

  const save = useMutation({
    mutationFn: () => editing
      ? updateProduct(editing.id, { branchId, name, description, sellingPrice: price, lastPurchaseCost: cost, commissionPercent, lowStockThreshold: Number(threshold), barcode })
      : createProduct({ branchId, name, description, sellingPrice: price, lastPurchaseCost: cost, commissionPercent, lowStockThreshold: Number(threshold), barcode }),
    onSuccess: async () => { clearProductForm(); setSuccessMessage('تم حفظ المنتج.'); await refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (product: Product) => updateProduct(
      product.id,
      { branchId, isActive: !product.isActive },
    ),
    onSuccess: async (_saved, product) => { setConfirmingToggle(null); setSuccessMessage(product.isActive ? 'تم إيقاف المنتج.' : 'تم تفعيل المنتج.'); await refresh(); },
  });
  const adjust = useMutation({
    mutationFn: () => adjustProductStock(adjusting!.id, { ...(branchId === undefined ? {} : { branchId }), quantityDelta: Number(delta), reason, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: async () => { setAdjusting(null); setDelta(''); setNote(''); setSuccessMessage('تم حفظ تسوية المخزون.'); await refresh(); },
  });
  /**
   * A product whose box already carries a supplier code keeps it and gets no
   * sticker. Only a product with no code of its own is given one of ours, which
   * is less printing and less sticking for the same scan at the till.
   */
  const generate = useMutation({
    mutationFn: (product: Product) => generateProductBarcode(product.id, branchId === undefined ? {} : { branchId }),
    onSuccess: async () => { setSuccessMessage('تم توليد الباركود.'); await refresh(); },
  });
  const commandPending = save.isPending || toggle.isPending || adjust.isPending || generate.isPending;

  return (
    <section className="space-y-6">
      <PageHeader
        title="المنتجات والمخزون"
        description="إدارة الأسعار والأرصدة وحركات المخزون لكل فرع."
        actions={scopeReady ? (
          <Button
            disabled={commandPending}
            onClick={() => { setAdjusting(null); setEditing(null); setCreateOpen(true); }}
          >
            <Plus className="size-4" aria-hidden />
            منتج جديد
          </Button>
        ) : undefined}
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
                <Label htmlFor="product-branch">الفرع</Label>
                <Select
                  id="product-branch"
                  className="max-w-sm"
                  value={selectedBranchId ?? ''}
                  disabled={commandPending}
                  onChange={(event) => {
                    if (commandPending) return;
                    setSelectedBranchId(event.target.value ? Number(event.target.value) : undefined);
                    setEditing(null); setCreateOpen(false); setConfirmingToggle(null); setAdjusting(null);
                    setMovementProductId(undefined); setMovementPage(1);
                  }}
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
            ? <EmptyState title="اختر فرعًا لإدارة مخزونه" />
            : <LoadingState label="جارٍ التحقق من الجلسة…" className="py-16" />}
        </Card>
      ) : (
        <>
          {formOpen ? (
            <Modal
              title={editing ? `تعديل ${editing.name}` : 'إضافة منتج'}
              className="max-h-[90dvh] max-w-2xl overflow-y-auto"
              onClose={() => { if (!commandPending) clearProductForm(); }}
            >
              <div className="space-y-4">
                <p className="text-[13px] text-muted">السعر والتكلفة بالجنيه؛ حد المخزون المنخفض يشغّل التنبيه في القائمة.</p>
                {draft.pending ? (
                  <DraftNotice
                    onRestore={() => {
                      const stored = draft.restore();
                      if (!stored) return;
                      setName(stored.name);
                      setDescription(stored.description);
                      setPrice(stored.price);
                      setCost(stored.cost);
                      setCommissionPercent(stored.commissionPercent ?? '0');
                      setThreshold(stored.threshold);
                      setBarcode(stored.barcode ?? '');
                    }}
                    onDiscard={draft.discard}
                  />
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="product-name">اسم المنتج</Label>
                    <Input id="product-name" aria-label="اسم المنتج" placeholder="اسم المنتج" disabled={commandPending} value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="product-description">وصف المنتج</Label>
                    <Input id="product-description" aria-label="وصف المنتج" placeholder="الوصف (اختياري)" disabled={commandPending} value={description} onChange={(event) => setDescription(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="product-price">سعر البيع</Label>
                    <Input id="product-price" aria-label="سعر البيع" className="text-start" placeholder="سعر البيع" disabled={commandPending} value={price} onChange={(event) => setPrice(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="product-cost">آخر تكلفة شراء</Label>
                    <Input id="product-cost" aria-label="آخر تكلفة شراء" className="text-start" placeholder="آخر تكلفة شراء" disabled={commandPending} value={cost} onChange={(event) => setCost(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="product-commission">عمولة البائع %</Label>
                    <Input id="product-commission" aria-label="عمولة البائع %" type="number" min="0" max="100" step="0.01" className="text-start" disabled={commandPending} value={commissionPercent} onChange={(event) => setCommissionPercent(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="product-barcode">الباركود</Label>
                    <Input id="product-barcode" aria-label="الباركود" className="text-start" placeholder="امسح باركود العلبة أو اتركه فارغًا" disabled={commandPending} value={barcode} onChange={(event) => setBarcode(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="product-threshold">حد المخزون المنخفض</Label>
                    <Input id="product-threshold" aria-label="حد المخزون المنخفض" type="number" min="0" className="text-start" disabled={commandPending} value={threshold} onChange={(event) => setThreshold(event.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
                  <Button disabled={!name.trim() || !price || commandPending} onClick={() => { if (!commandPending) save.mutate(); }}>
                    {editing ? 'حفظ التعديل' : 'إضافة منتج'}
                  </Button>
                  <Button variant="ghost" disabled={commandPending} onClick={clearProductForm}>إلغاء</Button>
                </div>
                {save.isError ? <FieldError>{errorText(save.error)}</FieldError> : null}
              </div>
            </Modal>
          ) : null}

          {adjusting ? (
            <Modal
              title={`تسوية مخزون ${adjusting.name}`}
              className="max-h-[90dvh] max-w-lg overflow-y-auto"
              onClose={() => { if (!commandPending) setAdjusting(null); }}
            >
              <div className="space-y-4">
                <p className="text-[13px] text-muted">الرصيد الحالي يتغير فورًا وتُسجَّل الحركة في السجل.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="adjust-delta">تغيير الكمية</Label>
                    <Input id="adjust-delta" aria-label="تغيير الكمية" type="number" className="text-start" disabled={commandPending} value={delta} onChange={(event) => setDelta(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="adjust-reason">سبب التسوية</Label>
                    <Select id="adjust-reason" aria-label="سبب التسوية" disabled={commandPending} value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
                      <option value="count_correction">تصحيح جرد</option>
                      <option value="wastage">هالك</option>
                      <option value="damage">تالف</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="adjust-note">ملاحظة التسوية</Label>
                    <Input id="adjust-note" aria-label="ملاحظة التسوية" placeholder="ملاحظة" disabled={commandPending} value={note} onChange={(event) => setNote(event.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
                  <Button disabled={!Number(delta) || commandPending} onClick={() => { if (!commandPending) adjust.mutate(); }}>حفظ</Button>
                  <Button variant="ghost" disabled={commandPending} onClick={() => setAdjusting(null)}>إلغاء</Button>
                </div>
                {adjust.isError ? <FieldError>{errorText(adjust.error)}</FieldError> : null}
              </div>
            </Modal>
          ) : null}

          <Card className="overflow-hidden shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 p-3 sm:p-4">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" aria-hidden />
                <Input aria-label="بحث في المنتجات" placeholder="بحث" className="ps-9" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Button
                variant={lowStock ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={lowStock}
                aria-label="عرض المنتجات منخفضة المخزون فقط"
                onClick={() => setLowStock((value) => !value)}
              >
                المخزون المنخفض
              </Button>
            </div>

            {products.isPending ? <LoadingState label="جارٍ تحميل المنتجات…" className="py-16" />
              : products.isError ? <EmptyState title="تعذر تحميل المنتجات" action={<Button onClick={() => void products.refetch()}>إعادة المحاولة</Button>} />
                : !products.data?.items.length ? (
                  <EmptyState
                    title={lowStock || search.trim() ? 'لا توجد منتجات مطابقة' : 'لا توجد منتجات'}
                    description={lowStock ? 'لا يوجد منتج تحت حد المخزون المنخفض.' : search.trim() ? 'جرّب بحثًا آخر.' : 'أضف أول منتج لهذا الفرع.'}
                    action={
                      !lowStock && !search.trim() ? (
                        <Button size="sm" disabled={commandPending} onClick={() => setCreateOpen(true)}>
                          <Plus className="size-4" aria-hidden />
                          إضافة أول منتج
                        </Button>
                      ) : undefined
                    }
                  />
                )
                  : (
                    // Content-width: a stretched table hands the spare width to the
                    // product column, leaving it far wider than any name it holds.
                    <DataTable minWidth="w-auto min-w-max">
                      <THead>
                        <TH>المنتج</TH>
                        <TH>الباركود</TH>
                        <TH numeric>السعر</TH>
                        <TH numeric>التكلفة</TH>
                        <TH numeric>عمولة البائع %</TH>
                        <TH numeric>الرصيد</TH>
                        <TH pinned>الإجراءات</TH>
                      </THead>
                      <tbody>
                        {products.data.items.map((product) => (
                          <TR key={product.id}>
                            <TD>
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{product.name}</span>
                                {product.quantity <= product.lowStockThreshold ? (
                                  <Badge variant="danger">منخفض</Badge>
                                ) : null}
                              </span>
                            </TD>
                            <TD className="tabular text-muted">{product.barcode ?? '—'}</TD>
                            <TD numeric>{product.sellingPrice}</TD>
                            <TD numeric className="text-muted">{product.lastPurchaseCost}</TD>
                            <TD numeric className="text-muted">{product.commissionPercent ?? '0.00'}%</TD>
                            <TD numeric className="font-medium">{product.quantity}</TD>
                            <TD pinned>
                              <RowActions>
                                {isAdmin ? <Link className="rounded-control px-2.5 py-1.5 text-sm font-medium hover:bg-surface" href={`/consumables?productId=${product.id}&branchId=${product.branchId}`}>ربط كمستهلك</Link> : null}
                                <Button size="sm" disabled={commandPending} onClick={() => { setCreateOpen(false); setEditing(null); setAdjusting(product); }}>تسوية</Button>
                                {product.barcode
                                  ? <Button variant="ghost" size="sm" disabled={commandPending} onClick={() => setLabelling(product)}>طباعة ملصق</Button>
                                  : <Button variant="ghost" size="sm" disabled={commandPending} onClick={() => generate.mutate(product)}>توليد باركود</Button>}
                                <Button variant="ghost" size="sm" disabled={commandPending} onClick={() => beginEdit(product)}>تعديل</Button>
                                <Button variant="ghost" size="sm" disabled={commandPending} onClick={() => product.isActive ? setConfirmingToggle(product) : toggle.mutate(product)}>
                                  {product.isActive ? 'إيقاف' : 'تفعيل'}
                                </Button>
                              </RowActions>
                            </TD>
                          </TR>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
          </Card>

          {toggle.isError ? <FieldError>{errorText(toggle.error)}</FieldError> : null}
          {generate.isError ? <FieldError>{errorText(generate.error)}</FieldError> : null}

          {labelling ? (
            <ProductLabelSheet products={[labelling]} onPrinted={() => setLabelling(null)} />
          ) : null}

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

          <Card className="overflow-hidden shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 p-3 sm:p-4">
              <SectionHeading title="سجل حركات المخزون" />
              <Select
                aria-label="تصفية الحركات حسب المنتج"
                className="w-auto min-w-48 max-w-full"
                value={movementProductId ?? ''}
                onChange={(event) => { setMovementProductId(event.target.value ? Number(event.target.value) : undefined); setMovementPage(1); }}
              >
                <option value="">كل المنتجات</option>
                {(catalogProducts.data?.items ?? products.data?.items ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </Select>
            </div>

            {movements.isError ? <EmptyState title="تعذر تحميل الحركات" action={<Button onClick={() => void movements.refetch()}>إعادة المحاولة</Button>} />
              : movements.isPending ? <LoadingState label="جارٍ تحميل حركات المخزون…" className="py-16" />
                : movements.data?.items.length ? (
                  <>
                    <DataTable>
                      <THead>
                        <TH>المنتج</TH>
                        <TH>السبب</TH>
                        <TH numeric>التغيير/الرصيد</TH>
                        <TH>المصدر</TH>
                        <TH>المنفذ</TH>
                        <TH>الوقت</TH>
                      </THead>
                      <tbody>
                        {movements.data.items.map((movement) => (
                          <TR key={movement.id}>
                            <TD className="font-medium">{movement.productName}</TD>
                            <TD>
                              {reasonLabels[movement.reason] ?? movement.reason}
                              {movement.note ? <span className="block text-xs text-muted">{movement.note}</span> : null}
                            </TD>
                            <TD numeric className="whitespace-nowrap">
                              <span>{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta} → {movement.balanceAfter}</span>
                            </TD>
                            <TD className="text-muted">
                              {sourceLabels[movement.sourceType] ?? movement.sourceType}{movement.sourceId ? ` #${movement.sourceId}` : ''}
                            </TD>
                            <TD className="text-muted">{movement.actingUsername}</TD>
                            <TD className="whitespace-nowrap text-muted">{cairoDate(movement.createdAt)}</TD>
                          </TR>
                        ))}
                      </tbody>
                    </DataTable>
                    <Pagination
                      summary={<>صفحة <span className="tabular">{movementPage}</span></>}
                      previousDisabled={movementPage <= 1}
                      nextDisabled={movementPage >= (movements.data.totalPages || 1)}
                      onPrevious={() => setMovementPage((page) => page - 1)}
                      onNext={() => setMovementPage((page) => page + 1)}
                    />
                  </>
                ) : <EmptyState title="لا توجد حركات بعد" />}
          </Card>
        </>
      )}
    </section>
  );
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Card, CardContent, EmptyState, Label } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { SuccessState } from '@/components/feedback/success-state';
import { Select } from '@/components/form/select';
import { PageHeader } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { listCatalogBranches } from '@/features/catalog';
import { useAdminBranch } from '@/hooks/use-admin-branch';
import { listAllProducts, productQueryKeys } from '@/features/products';
import { notifyError, notifySuccess } from '@/lib/notify';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { useFormDraft } from '@/lib/form-draft';
import { createUuid } from '@/lib/uuid';

import {
  cancelPurchase,
  createSupplier,
  listSuppliers,
  listPurchases,
  postPurchase,
  updateSupplier,
  type Purchase,
  type Supplier,
} from '../api/suppliers-api';
import { supplierQueryKeys } from '../query-keys';
import { PurchaseHistorySection } from './purchase-history-section';
import { PurchaseInvoicePanel } from './purchase-invoice-panel';
import { SupplierFormModal } from './supplier-form-modal';
import { SupplierListSection } from './supplier-list-section';
import {
  blankLine,
  cents,
  quantityValue,
  todayInCairo,
  type DraftLine,
} from './supplier-purchase-money';

export function SuppliersPurchasesView() {
  const queryClient = useQueryClient();
  /**
   * A cashier runs the suppliers and purchases of their own branch: the server pins every
   * request to the branch of their account, so only an admin picks which branch to work on.
   */
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const { branchId: selectedBranchId, setBranchId: setSelectedBranchId } = useAdminBranch();
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
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
  const [supplierPage, setSupplierPage] = useState(1);
  const [page, setPage] = useState(1);
  const [historySupplier, setHistorySupplier] = useState('');
  const [historyProduct, setHistoryProduct] = useState('');
  const [status, setStatus] = useState('');
  const [cancelling, setCancelling] = useState<Purchase | null>(null);
  const [reason, setReason] = useState('');
  const [successMessage, setSuccessMessage] = useState<string>();
  const [purchasePanelOpen, setPurchasePanelOpen] = useState(false);

  const branches = useQuery({
    queryKey: ['supplier-branches'],
    queryFn: () => listCatalogBranches(),
    enabled: isAdmin,
  });
  const branchScope = branchId === undefined ? {} : { branchId };
  const supplierParams = { ...branchScope, page: supplierPage, pageSize: 20 };
  const suppliers = useQuery({
    queryKey: supplierQueryKeys.suppliers(supplierParams),
    queryFn: () => listSuppliers(supplierParams),
    enabled: scopeReady,
  });
  const allSuppliers = useQuery({
    queryKey: supplierQueryKeys.suppliers({ ...branchScope, options: true }),
    queryFn: () => fetchAllPages((page) => listSuppliers({ ...branchScope, page, pageSize: 100 })),
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
    setEditing(null); setSupplierFormOpen(false); setSupplierName(''); setPhone(''); setNotes('');
  };
  const openNewSupplier = () => {
    setEditing(null);
    setSupplierName(''); setPhone(''); setNotes('');
    setSupplierFormOpen(true);
  };
  const resetDraft = () => {
    setSupplierId(''); setCorrectionOf(undefined); setLines([blankLine(lineKey)]);
    setPurchaseDate(todayInCairo());
    setIdempotencyKey(createUuid());
    setLineKey((value) => value + 1);
  };
  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const supplierDraft = useFormDraft(
    editing === null && supplierFormOpen ? `supplier:${branchId ?? 'own'}` : null,
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
    clearSupplier(); resetDraft(); setPurchasePanelOpen(false); setHistorySupplier(''); setHistoryProduct(''); setStatus('');
    setPage(1); setSupplierPage(1); setConfirmingToggle(null); setCancelling(null); setReason('');
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
    setPurchasePanelOpen(true);
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
    onSuccess: async () => { supplierDraft.clear(); clearSupplier(); setSuccessMessage('تم حفظ المورد.'); notifySuccess('تم حفظ المورد.'); await refresh(); },
    onError: (error: unknown) => notifyError(error),
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
      notifySuccess(supplier.isActive ? 'تم إيقاف المورد.' : 'تم تفعيل المورد.');
      await refresh();
    },
    onError: (error: unknown) => notifyError(error),
  });
  const post = useMutation({
    mutationFn: () => postPurchase({
      ...branchScope, idempotencyKey, supplierId: Number(supplierId), purchaseDate,
      lines: lines.map((line) => ({
        productId: Number(line.productId), quantity: Number(line.quantity), unitCost: line.unitCost,
      })),
      ...(correctionOf === undefined ? {} : { correctsPurchaseId: correctionOf }),
    }),
    onSuccess: async () => { purchaseDraft.clear(); resetDraft(); setPurchasePanelOpen(false); setSuccessMessage('تم ترحيل المشتريات إلى المخزون.'); notifySuccess('تم ترحيل المشتريات إلى المخزون.'); await refreshPurchase(); },
    onError: (error: unknown) => notifyError(error),
  });
  const cancel = useMutation({
    mutationFn: () => cancelPurchase(cancelling!.id, { ...branchScope, reason }),
    onSuccess: async () => { closeCancellation(); setSuccessMessage('تم إلغاء المشتريات وعكس أثر المخزون.'); notifySuccess('تم إلغاء المشتريات وعكس أثر المخزون.'); await refreshPurchase(); },
    onError: (error: unknown) => notifyError(error),
  });
  const chosenProductIds = new Set(lines.map((line) => line.productId));
  const validLines = lines.length > 0 && chosenProductIds.size === lines.length && lines.every((line) => (
    Number(line.productId) && quantityValue(line.quantity) !== null && cents(line.unitCost) > BigInt(0)
  ));
  const activeSuppliers = allSuppliers.data?.filter((supplier: Supplier) => supplier.isActive) ?? [];
  const commandPending = saveSupplier.isPending || toggleSupplier.isPending || post.isPending || cancel.isPending;
  const closePurchasePanel = () => {
    if (commandPending) return;
    setPurchasePanelOpen(false);
  };

  useEffect(() => {
    if (!purchasePanelOpen) return;
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || commandPending) return;
      event.stopPropagation();
      setPurchasePanelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      html.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [purchasePanelOpen, commandPending]);

  return (
    <section className="space-y-6">
      <PageHeader
        title="الموردون والمشتريات"
        description="ترحيل مشتريات مدفوعة بالكامل إلى المخزون مع سجل غير قابل للتعديل."
        actions={scopeReady ? (
          <>
            <Button variant="secondary" disabled={commandPending} onClick={openNewSupplier}>
              <Plus className="size-4" aria-hidden />
              مورد جديد
            </Button>
            <Button disabled={commandPending} onClick={() => setPurchasePanelOpen(true)}>
              <Plus className="size-4" aria-hidden />
              إضافة فاتورة مشتريات
            </Button>
          </>
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
          {supplierFormOpen || editing ? (
            <SupplierFormModal
              editing={editing}
              commandPending={commandPending}
              supplierName={supplierName}
              phone={phone}
              notes={notes}
              supplierDraft={supplierDraft}
              saveSupplier={saveSupplier}
              setSupplierName={setSupplierName}
              setPhone={setPhone}
              setNotes={setNotes}
              clearSupplier={clearSupplier}
            />
          ) : null}

          <SupplierListSection
            suppliers={suppliers}
            supplierPage={supplierPage}
            setSupplierPage={setSupplierPage}
            branchScope={branchScope}
            commandPending={commandPending}
            toggleSupplier={toggleSupplier}
            openNewSupplier={openNewSupplier}
            onEdit={(supplier) => { setSupplierFormOpen(true); setEditing(supplier); setSupplierName(supplier.name); setPhone(supplier.phone ?? ''); setNotes(supplier.notes ?? ''); }}
            onToggle={(supplier) => supplier.isActive ? setConfirmingToggle(supplier) : toggleSupplier.mutate(supplier)}
          />

          {purchasePanelOpen ? (
            <PurchaseInvoicePanel
              correctionOf={correctionOf}
              commandPending={commandPending}
              closePurchasePanel={closePurchasePanel}
              purchaseDraft={purchaseDraft}
              setSupplierId={setSupplierId}
              setPurchaseDate={setPurchaseDate}
              setLines={setLines}
              setLineKey={setLineKey}
              suppliers={suppliers}
              activeProducts={activeProducts}
              purchaseDate={purchaseDate}
              supplierId={supplierId}
              activeSuppliers={activeSuppliers}
              openNewSupplier={openNewSupplier}
              lines={lines}
              lineKey={lineKey}
              chosenProductIds={chosenProductIds}
              updateLine={updateLine}
              validLines={validLines}
              post={post}
              resetDraft={resetDraft}
              setPurchasePanelOpen={setPurchasePanelOpen}
              setIdempotencyKey={setIdempotencyKey}
            />
          ) : null}

          <PurchaseHistorySection
            historySupplier={historySupplier}
            setHistorySupplier={setHistorySupplier}
            historyProduct={historyProduct}
            setHistoryProduct={setHistoryProduct}
            status={status}
            setStatus={setStatus}
            setPage={setPage}
            allSuppliers={allSuppliers}
            historyProducts={historyProducts}
            purchases={purchases}
            page={page}
            commandPending={commandPending}
            openCancellation={openCancellation}
            beginCorrection={beginCorrection}
            confirmingToggle={confirmingToggle}
            toggleSupplier={toggleSupplier}
            setConfirmingToggle={setConfirmingToggle}
            cancelling={cancelling}
            reason={reason}
            setReason={setReason}
            cancel={cancel}
            closeCancellation={closeCancellation}
          />
        </>
      )}
    </section>
  );
}

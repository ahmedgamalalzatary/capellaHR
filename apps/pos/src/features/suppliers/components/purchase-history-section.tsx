'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label, Modal } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { SectionHeading } from '@/components/layout/page-header';

import { type Purchase, type Supplier } from '../api/suppliers-api';
import { errorText } from './supplier-purchase-money';

export function PurchaseHistorySection({
  historySupplier,
  setHistorySupplier,
  historyProduct,
  setHistoryProduct,
  status,
  setStatus,
  setPage,
  allSuppliers,
  historyProducts,
  purchases,
  page,
  commandPending,
  openCancellation,
  beginCorrection,
  confirmingToggle,
  toggleSupplier,
  setConfirmingToggle,
  cancelling,
  reason,
  setReason,
  cancel,
  closeCancellation,
}: {
  historySupplier: string;
  setHistorySupplier: (value: string) => void;
  historyProduct: string;
  setHistoryProduct: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  setPage: (value: number | ((value: number) => number)) => void;
  allSuppliers: UseQueryResult<Supplier[]>;
  historyProducts: UseQueryResult<{ items: Array<{ id: number; name: string }> }>;
  purchases: UseQueryResult<{ items: Purchase[]; meta: { totalPages: number } }>;
  page: number;
  commandPending: boolean;
  openCancellation: (purchase: Purchase) => void;
  beginCorrection: (purchase: Purchase) => void;
  confirmingToggle: Supplier | null;
  toggleSupplier: {
    isError: boolean;
    error: unknown;
    mutate: (supplier: Supplier) => void;
    reset: () => void;
  };
  setConfirmingToggle: (value: Supplier | null) => void;
  cancelling: Purchase | null;
  reason: string;
  setReason: (value: string) => void;
  cancel: { isError: boolean; error: unknown; mutate: () => void };
  closeCancellation: () => void;
}) {
  return (
    <>
      <Card className="overflow-hidden shadow-card">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <SectionHeading title="سجل المشتريات" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select aria-label="تصفية حسب المورد" value={historySupplier} onChange={(event) => { setHistorySupplier(event.target.value); setPage(1); }}>
              <option value="">كل الموردين</option>
              {allSuppliers.data?.map((supplier: Supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
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
              page={page}
              totalPages={purchases.data.meta.totalPages}
              onPage={setPage}
              persistenceKey="pos:suppliers:purchases"
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
  );
}

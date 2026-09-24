'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import { Button, EmptyState, Input, Label } from '@capella/ui';

import { DraftNotice } from '@/components/feedback/draft-notice';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { ProductCombobox } from '@/components/form/product-combobox';
import { Select } from '@/components/form/select';

import { type FormDraft } from '@/lib/form-draft';
import { createUuid } from '@/lib/uuid';
import { type Product } from '@/features/products';

import { type Supplier } from '../api/suppliers-api';
import {
  blankLine,
  errorText,
  exactTotal,
  lineAmount,
  type DraftLine,
} from './supplier-purchase-money';

export function PurchaseInvoicePanel({
  correctionOf,
  commandPending,
  closePurchasePanel,
  purchaseDraft,
  setSupplierId,
  setPurchaseDate,
  setLines,
  setLineKey,
  suppliers,
  activeProducts,
  purchaseDate,
  supplierId,
  activeSuppliers,
  openNewSupplier,
  lines,
  lineKey,
  chosenProductIds,
  updateLine,
  validLines,
  post,
  resetDraft,
  setPurchasePanelOpen,
  setIdempotencyKey,
}: {
  correctionOf: number | undefined;
  commandPending: boolean;
  closePurchasePanel: () => void;
  purchaseDraft: FormDraft<{ supplierId: string; purchaseDate: string; lines: DraftLine[] }>;
  setSupplierId: (value: string) => void;
  setPurchaseDate: (value: string) => void;
  setLines: (value: DraftLine[] | ((current: DraftLine[]) => DraftLine[])) => void;
  setLineKey: (value: number | ((value: number) => number)) => void;
  suppliers: UseQueryResult<unknown>;
  activeProducts: UseQueryResult<{ items: Product[] }>;
  purchaseDate: string;
  supplierId: string;
  activeSuppliers: Supplier[];
  openNewSupplier: () => void;
  lines: DraftLine[];
  lineKey: number;
  chosenProductIds: Set<string>;
  updateLine: (key: number, changes: Partial<DraftLine>) => void;
  validLines: boolean;
  post: { isError: boolean; error: unknown; mutate: () => void };
  resetDraft: () => void;
  setPurchasePanelOpen: (value: boolean) => void;
  setIdempotencyKey: (value: string) => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex h-dvh justify-end bg-black/40"
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-panel-title"
        className="flex h-full min-h-0 w-full max-w-xl flex-col bg-paper shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            <h2 id="purchase-panel-title" className="text-base font-semibold text-ink">
              {correctionOf === undefined ? 'ترحيل مشتريات جديدة' : `تصحيح للمشتريات #${correctionOf}`}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              المشتريات مدفوعة بالكامل عند الترحيل، ولا تُعدَّل بعده إلا بتصحيح جديد.
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="إغلاق فاتورة المشتريات" disabled={commandPending} onClick={closePurchasePanel}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
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
              <div className="space-y-1.5">
                <Label htmlFor="purchase-date">تاريخ المشتريات</Label>
                <Input id="purchase-date" type="date" disabled={commandPending} value={purchaseDate} onChange={(event) => { if (commandPending) return; setIdempotencyKey(createUuid()); setPurchaseDate(event.target.value); }} />
                <p className="text-[12px] text-muted">اختر تاريخ الفاتورة الفعلي حتى يبقى حركة المخزون مرتبة زمنياً.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="purchase-supplier">المورد للمشتريات</Label>
                <div className="flex flex-wrap items-end gap-2">
                  <Select
                    id="purchase-supplier"
                    className="min-w-0 flex-1"
                    value={supplierId}
                    disabled={commandPending}
                    onChange={(event) => { if (commandPending) return; setIdempotencyKey(createUuid()); setSupplierId(event.target.value); }}
                  >
                    <option value="">اختر المورد</option>
                    {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </Select>
                  <Button variant="secondary" size="sm" disabled={commandPending} onClick={openNewSupplier}>
                    مورد جديد
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-ink">بنود الفاتورة</p>
                    <p className="text-[12px] text-muted">كل منتج يظهر مرة واحدة داخل نفس الفاتورة.</p>
                  </div>
                  <Button variant="secondary" size="sm" disabled={commandPending} onClick={() => { if (commandPending) return; setIdempotencyKey(createUuid()); setLines((current) => [blankLine(lineKey), ...current]); setLineKey((value) => value + 1); }}>
                    <Plus className="size-4" aria-hidden />
                    إضافة بند
                  </Button>
                </div>

                <ul className="space-y-3">
                  {lines.map((line, index) => (
                    <li key={line.key} className="rounded-control border border-line p-3">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
                        <div className="space-y-1">
                          <Label htmlFor={`purchase-product-${line.key}`}>المنتج</Label>
                          <ProductCombobox
                            id={`purchase-product-${line.key}`}
                            label="المنتج"
                            value={line.productId}
                            disabled={commandPending}
                            products={(activeProducts.data?.items ?? []).filter((product) => (
                              String(product.id) === line.productId
                              || !chosenProductIds.has(String(product.id))
                            ))}
                            onChange={(productId) => { if (!commandPending) updateLine(line.key, { productId }); }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`purchase-quantity-${line.key}`}>الكمية</Label>
                          <Input id={`purchase-quantity-${line.key}`} type="number" min="1" className="text-start" disabled={commandPending} value={line.quantity} onChange={(event) => { if (!commandPending) updateLine(line.key, { quantity: event.target.value }); }} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`purchase-cost-${line.key}`}>تكلفة الوحدة</Label>
                          <Input id={`purchase-cost-${line.key}`} inputMode="decimal" className="text-start" disabled={commandPending} value={line.unitCost} onChange={(event) => { if (!commandPending) updateLine(line.key, { unitCost: event.target.value }); }} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">إجمالي السعر</p>
                          <p className="flex h-9 items-center rounded-control border border-line bg-surface/50 px-3 tabular text-sm">{lineAmount(line)}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted">
                        <span>إجمالي البند: {lineAmount(line)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`حذف البند ${index + 1}`}
                          disabled={commandPending || lines.length === 1}
                          onClick={() => { if (commandPending) return; setIdempotencyKey(createUuid()); setLines((current) => current.filter((entry) => entry.key !== line.key)); }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                          حذف البند
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <dl className="space-y-2 rounded-control border border-line bg-surface/40 px-4 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">إجمالي الفاتورة</dt>
                  <dd className="tabular">{exactTotal(lines)}</dd>
                </div>
                <div className="flex justify-between gap-3 font-semibold text-ink">
                  <dt>الإجمالي النهائي</dt>
                  <dd className="tabular">{exactTotal(lines)} ج.م</dd>
                </div>
              </dl>
              <p className="tabular text-base font-semibold text-ink">الإجمالي: {exactTotal(lines)} ج.م</p>
              {post.isError ? <FieldError>{errorText(post.error)}</FieldError> : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-line/70 bg-paper px-5 py-4">
          <Button disabled={!supplierId || !purchaseDate || !validLines || commandPending} onClick={() => { if (!commandPending) post.mutate(); }}>
            {correctionOf === undefined ? 'ترحيل المشتريات' : 'ترحيل التصحيح'}
          </Button>
          {correctionOf !== undefined ? <Button variant="ghost" disabled={commandPending} onClick={() => { resetDraft(); setPurchasePanelOpen(false); }}>إلغاء التصحيح</Button> : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

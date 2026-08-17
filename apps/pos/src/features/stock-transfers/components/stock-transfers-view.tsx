'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { listCashierSessionBranches } from '@/features/cashier-sessions';
import { listAllProducts } from '@/features/products';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { createStockTransfer, listStockTransfers } from '../api/stock-transfers-api';
import { stockTransferQueryKeys } from '../query-keys';

const errorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const columns = [
  { key: 'date', label: 'التاريخ' },
  { key: 'from', label: 'من فرع' },
  { key: 'to', label: 'إلى فرع' },
  { key: 'items', label: 'المنتجات' },
  { key: 'total', label: 'التكلفة' },
  { key: 'invoice', label: 'الفاتورة' },
] as const;

const toCents = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
};
const money = (cents: number) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

type TransferLine = { key: string; productId: number | undefined; quantity: string };
const emptyLine = (): TransferLine => ({
  key: crypto.randomUUID(), productId: undefined, quantity: '1',
});

/**
 * Moving products between branches is internal trade: the sending branch sells
 * to the receiving one at cost, with no seller and no commission. One transfer
 * carries as many products as the admin needs to move.
 */
export function StockTransfersView() {
  const queryClient = useQueryClient();
  const [sourceBranchId, setSourceBranchId] = useState<number>();
  const [destinationBranchId, setDestinationBranchId] = useState<number>();
  const [lines, setLines] = useState<TransferLine[]>([emptyLine()]);
  const [note, setNote] = useState('');
  // One key for this draft, not one per click: a retry after a lost response
  // must land on the transfer already posted rather than move the stock again.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string>();
  const [page, setPage] = useState(1);

  const branches = useQuery({
    queryKey: ['erp-stock-transfers', 'branches'],
    queryFn: () => fetchAllPages((branchPage) => listCashierSessionBranches(branchPage)),
  });
  const products = useQuery({
    queryKey: ['erp-stock-transfers', 'products', sourceBranchId ?? null],
    queryFn: () => listAllProducts({ branchId: sourceBranchId!, isActive: true }),
    enabled: sourceBranchId !== undefined,
  });
  const transfers = useQuery({
    queryKey: stockTransferQueryKeys.list({ page }),
    queryFn: () => listStockTransfers({ page }),
  });

  const available = products.data?.items ?? [];
  const productById = new Map(available.map((product) => [product.id, product]));
  const chosenIds = lines.flatMap((line) => (line.productId === undefined ? [] : [line.productId]));
  const totalCost = money(lines.reduce((sum, line) => {
    const product = line.productId === undefined ? undefined : productById.get(line.productId);
    const count = Number(line.quantity);
    // A half-typed quantity counts as nothing rather than as fractional cents.
    return product && Number.isInteger(count) && count > 0
      ? sum + toCents(product.lastPurchaseCost) * count
      : sum;
  }, 0));

  const updateLine = (key: string, changes: Partial<TransferLine>) => {
    setLines((current) => current.map((line) => (
      line.key === key ? { ...line, ...changes } : line
    )));
  };

  const transfer = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: async () => {
      setLines([emptyLine()]);
      setNote('');
      setIdempotencyKey(crypto.randomUUID());
      setFormError(undefined);
      await queryClient.invalidateQueries({ queryKey: stockTransferQueryKeys.all });
    },
  });

  const submit = () => {
    const filled = lines.flatMap((line) => {
      const count = Number(line.quantity);
      return line.productId === undefined || !Number.isInteger(count) || count < 1
        ? []
        : [{ productId: line.productId, quantity: count }];
    });
    if (sourceBranchId === undefined || destinationBranchId === undefined || !filled.length
      || filled.length !== lines.length) {
      setFormError('اختر الفرع المُرسِل والمستلم، ولكل بند منتجًا وكمية صحيحة');
      return;
    }
    setFormError(undefined);
    transfer.mutate({
      idempotencyKey,
      sourceBranchId,
      destinationBranchId,
      lines: filled,
      // A note is optional; a transfer stands on its own without one.
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  const items = transfers.data?.items ?? [];
  const meta = transfers.data?.meta;

  return (
    <section className="space-y-6">
      <PageHeader
        title="تحويل المنتجات بين الفروع"
        description="تجارة داخلية: تنتقل المنتجات بسعر التكلفة كبيع من الفرع المُرسِل إلى الفرع المستلم، دون بائع ودون عمولة."
      />

      <Card className="shadow-card">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-source">الفرع المُرسِل</Label>
              <Select
                id="transfer-source"
                aria-label="الفرع المُرسِل"
                disabled={branches.isPending || branches.isError}
                value={sourceBranchId ?? ''}
                onChange={(event) => {
                  const value = event.target.value ? Number(event.target.value) : undefined;
                  setSourceBranchId(value);
                  setLines([emptyLine()]);
                  if (value !== undefined && value === destinationBranchId) {
                    setDestinationBranchId(undefined);
                  }
                }}
              >
                <option value="">اختر الفرع</option>
                {(branches.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-destination">الفرع المستلم</Label>
              <Select
                id="transfer-destination"
                aria-label="الفرع المستلم"
                disabled={branches.isPending || branches.isError}
                value={destinationBranchId ?? ''}
                onChange={(event) => setDestinationBranchId(
                  event.target.value ? Number(event.target.value) : undefined,
                )}
              >
                <option value="">اختر الفرع</option>
                {/* A branch never transfers to itself. */}
                {(branches.data ?? []).filter((branch) => branch.id !== sourceBranchId)
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-note">ملاحظة (اختياري)</Label>
              <Input
                id="transfer-note"
                aria-label="ملاحظة"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 border-t border-line/70 pt-4">
            <p className="text-sm font-medium">المنتجات المحوَّلة</p>
            <ul className="space-y-2">
              {lines.map((line, index) => {
                const product = line.productId === undefined
                  ? undefined : productById.get(line.productId);
                return (
                  <li key={line.key} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor={`transfer-product-${line.key}`}>
                        {`المنتج ${index + 1}`}
                      </Label>
                      <Select
                        id={`transfer-product-${line.key}`}
                        aria-label={`المنتج ${index + 1}`}
                        disabled={sourceBranchId === undefined || products.isPending
                          || products.isError}
                        value={line.productId ?? ''}
                        onChange={(event) => updateLine(line.key, {
                          productId: event.target.value ? Number(event.target.value) : undefined,
                        })}
                      >
                        <option value="">اختر المنتج</option>
                        {available
                          // A product may appear once per transfer.
                          .filter((entry) => (
                            entry.id === line.productId || !chosenIds.includes(entry.id)
                          ))
                          .map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {`${entry.name} (متاح ${entry.quantity})`}
                            </option>
                          ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`transfer-quantity-${line.key}`}>
                        {`الكمية ${index + 1}`}
                      </Label>
                      <Input
                        id={`transfer-quantity-${line.key}`}
                        aria-label={`الكمية ${index + 1}`}
                        type="number"
                        min={1}
                        max={product?.quantity}
                        value={line.quantity}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`حذف البند ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines((current) => current.filter((entry) => (
                        entry.key !== line.key
                      )))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              disabled={sourceBranchId === undefined || chosenIds.length >= available.length}
              onClick={() => setLines((current) => [...current, emptyLine()])}
            >
              <Plus className="size-4" aria-hidden />
              إضافة منتج
            </Button>
          </div>

          <p className="text-sm text-muted">
            إجمالي تكلفة التحويل: <span className="tabular font-semibold text-ink">{totalCost}</span>
          </p>
          {formError ? <FieldError>{formError}</FieldError> : null}
          {transfer.isError ? <FieldError>{errorMessage(transfer.error)}</FieldError> : null}
          {branches.isError ? <FieldError>{errorMessage(branches.error)}</FieldError> : null}
          {/* Without the branch's products there is nothing to choose from, so
              the failure has to be said rather than left as an empty list. */}
          {products.isError ? <FieldError>{errorMessage(products.error)}</FieldError> : null}

          <div className="border-t border-line/70 pt-4">
            <Button disabled={transfer.isPending} onClick={submit}>
              <ArrowLeftRight className="size-4" aria-hidden />
              تنفيذ التحويل
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <SectionHeading title="التحويلات السابقة" />
        <Card className="overflow-hidden shadow-card">
          {transfers.isPending ? (
            <LoadingState label="جارٍ تحميل التحويلات…" className="py-16" />
          ) : transfers.isError ? (
            <EmptyState
              title="تعذر تحميل التحويلات"
              description={errorMessage(transfers.error) ?? undefined}
              action={(
                <Button variant="secondary" size="sm" onClick={() => void transfers.refetch()}>
                  إعادة المحاولة
                </Button>
              )}
            />
          ) : !items.length ? (
            <EmptyState title="لا توجد تحويلات بعد" />
          ) : (
            <DataTable>
              <THead>
                {columns.map((column) => <TH key={column.key}>{column.label}</TH>)}
              </THead>
              <tbody>
                {items.map((record) => (
                  <TR key={record.id}>
                    <TD className="tabular">{record.transferDate}</TD>
                    <TD>{record.sourceBranchName}</TD>
                    <TD>{record.destinationBranchName}</TD>
                    <TD className="text-muted">
                      {record.lines.map((line) => `${line.productName} × ${line.quantity}`).join('، ')}
                    </TD>
                    <TD className="tabular">{record.totalCost}</TD>
                    <TD className="tabular text-muted">{record.invoiceNumber}</TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
          {meta && meta.totalPages > 1 ? (
            <Pagination
              summary={(
                <>
                  صفحة <span className="tabular">{meta.page}</span> من{' '}
                  <span className="tabular">{meta.totalPages}</span>
                </>
              )}
              previousDisabled={page <= 1}
              nextDisabled={page >= meta.totalPages}
              onPrevious={() => setPage((value) => Math.max(1, value - 1))}
              onNext={() => setPage((value) => value + 1)}
            />
          ) : null}
        </Card>
      </div>
    </section>
  );
}

'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button, Card, EmptyState, Input } from '@capella/ui';
import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { ApiError } from '@/lib/api/client';
import { useBarcodeScanner } from '@/lib/barcode/use-barcode-scanner';
import { listSellableProducts, lookupProductByBarcode, type ProductSaleItem } from '../api/products-api';
import { productQueryKeys } from '../query-keys';

export function ProductPicker({ branchId, onSelect }: { branchId?: number; onSelect: (product: ProductSaleItem) => void }) {
  const [search, setSearch] = useState('');
  const trimmed = search.trim();
  const result = useInfiniteQuery({
    queryKey: productQueryKeys.list({ branchId, search: trimmed, picker: true }),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listSellableProducts({ ...(branchId === undefined ? {} : { branchId }), ...(trimmed ? { search: trimmed } : {}), page: pageParam, pageSize: 50 }),
    getNextPageParam: (lastPage) => lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });
  const items = result.data?.pages.flatMap((page) => page.items) ?? [];

  /**
   * A scan drops the product straight into the sale. The stock rules are the
   * ones the list already applies — a stopped or empty product is refused here
   * exactly as its row is disabled there.
   */
  const [scanError, setScanError] = useState<string | null>(null);
  const onScan = useCallback(async (code: string) => {
    setScanError(null);
    try {
      const product = await lookupProductByBarcode(code, branchId === undefined ? {} : { branchId });
      if (!product.isActive) {
        setScanError(`${product.name}: المنتج موقوف عن البيع`);
        return;
      }
      if (product.quantity <= 0) {
        setScanError(`${product.name}: لا يوجد رصيد متاح`);
        return;
      }
      onSelect({ ...product, price: product.sellingPrice, quantityAvailable: product.quantity });
    } catch (cause) {
      setScanError(cause instanceof ApiError ? cause.message : 'تعذر قراءة الباركود. حاول مرة أخرى.');
    }
  }, [branchId, onSelect]);
  useBarcodeScanner({ onScan: (code) => void onScan(code) });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" aria-hidden />
        <Input aria-label="بحث عن منتج" placeholder="اسم المنتج" className="ps-9" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {scanError ? <Notice tone="danger" role="alert">{scanError}</Notice> : null}

      {result.isPending ? (
        <LoadingState label="جارٍ تحميل المنتجات…" align="start" className="p-0" />
      ) : result.isError && !result.data ? (
        <EmptyState title="تعذر تحميل المنتجات" action={<Button size="sm" onClick={() => void result.refetch()}>إعادة المحاولة</Button>} />
      ) : !items.length ? (
        <EmptyState title="لا توجد منتجات متاحة" />
      ) : (
        <Card className="scroll-thin max-h-72 overflow-y-auto shadow-card">
          <ul>
            {items.map((product) => (
              <li key={product.id} className="border-b border-line/60 last:border-0">
                <button
                  type="button"
                  disabled={product.quantity <= 0}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => onSelect({ ...product, price: product.sellingPrice, quantityAvailable: product.quantity })}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{product.name}</span>
                    <span className="block text-[13px] text-muted">متاح: {product.quantity}</span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink">{product.sellingPrice} ج.م</span>
                </button>
              </li>
            ))}
          </ul>
          {result.hasNextPage ? (
            <div className="border-t border-line p-3 text-center">
              <Button size="sm" variant="ghost" disabled={result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>
                {result.isFetchingNextPage ? 'جارٍ تحميل المزيد…' : result.isFetchNextPageError ? 'إعادة المحاولة' : 'تحميل المزيد'}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}

'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, EmptyState, Input } from '@capella/ui';
import { LoadingState } from '@/components/feedback/loading-state';
import { listSellableProducts, type ProductSaleItem } from '../api/products-api';
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
  return <div className="space-y-3">
    <Input aria-label="بحث عن منتج" placeholder="اسم المنتج" value={search} onChange={(event) => setSearch(event.target.value)} />
    {result.isPending ? <LoadingState label="جارٍ تحميل المنتجات…" className="p-0 text-start" /> : result.isError && !result.data ? <EmptyState title="تعذر تحميل المنتجات" action={<Button size="sm" onClick={() => void result.refetch()}>إعادة المحاولة</Button>} /> : !items.length ? <EmptyState title="لا توجد منتجات متاحة" /> : <Card><ul>{items.map((product) => <li key={product.id} className="border-b border-line/60 last:border-0"><button type="button" disabled={product.quantity <= 0} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start disabled:opacity-50" onClick={() => onSelect({ ...product, price: product.sellingPrice, quantityAvailable: product.quantity })}><span><span className="block font-medium">{product.name}</span><span className="text-sm text-muted">متاح: {product.quantity}</span></span><span dir="ltr">{product.sellingPrice} ج.م</span></button></li>)}</ul>{result.hasNextPage ? <div className="border-t border-line p-3 text-center"><Button size="sm" variant="ghost" disabled={result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>{result.isFetchingNextPage ? 'جارٍ تحميل المزيد…' : result.isFetchNextPageError ? 'إعادة المحاولة' : 'تحميل المزيد'}</Button></div> : null}</Card>}
  </div>;
}

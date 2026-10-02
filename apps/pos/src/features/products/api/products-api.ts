import type { CreateProductInput, ListStockMovementsQuery, UpdateProductInput } from '@capella/contracts';
import type { StockBatch, AdjustProductStockInput } from '@capella/contracts';
import { api } from '@/lib/api/client';

export interface Product {
  batches?: StockBatch[];
  id: number; branchId: number; name: string; description: string | null;
  sellingPrice: string; lastPurchaseCost: string; commissionPercent?: string; lowStockThreshold: number;
  barcode: string | null;
  isActive: boolean; quantity: number; createdAt: string; updatedAt: string;
}
export type SellableProduct = Pick<Product, 'id' | 'branchId' | 'name' | 'description' | 'sellingPrice' | 'barcode' | 'isActive' | 'quantity'>;
export interface ProductSaleItem extends SellableProduct { price: string; quantityAvailable: number }
export interface StockMovement {
  batches?: import('@capella/contracts').BatchAllocation[] | null;
  id: number; productId: number; branchId: number; reason: string; sourceType: string;
  sourceId: number | null; quantityDelta: number; balanceAfter: number;
  actingAccountId: number; note: string | null; createdAt: string;
  productName: string; actingUsername: string;
}
const query = (params: Record<string, string | number | boolean | undefined>) => {
  const value = new URLSearchParams();
  for (const [key, entry] of Object.entries(params)) if (entry !== undefined && entry !== '') value.set(key, String(entry));
  const serialized = value.toString();
  return serialized ? `?${serialized}` : '';
};
export const getProductBatches = (id: number, params: { branchId?: number } = {}) => api.get<StockBatch[]>(`/erp/products/${id}/batches${query(params)}`);
export const updateProductBatchExpiry = (id: number, batchId: number, input: { expiryDate: string | null; branchId?: number }) => api.patch<StockBatch[]>(`/erp/products/${id}/batches/${batchId}`, input);
export const listProducts = (params: { branchId?: number; search?: string; isActive?: boolean; lowStock?: boolean; page?: number; pageSize?: number } = {}) => api.getPage<Product>(`/erp/products${query(params)}`);
export const listAllProducts = async (params: { branchId?: number; search?: string; isActive?: boolean; lowStock?: boolean } = {}) => {
  const pageSize = 100;
  const first = await listProducts({ ...params, page: 1, pageSize });
  const items = [...first.items];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    const result = await listProducts({ ...params, page, pageSize });
    items.push(...result.items);
  }
  return { ...first, items };
};
export const listSellableProducts = (params: { branchId?: number; search?: string; page?: number; pageSize?: number } = {}) => api.getPage<SellableProduct>(`/erp/products${query({ ...params, isActive: true })}`);
export const createProduct = (input: CreateProductInput) => api.post<Product>('/erp/products', input);
export const updateProduct = (id: number, input: UpdateProductInput) => api.patch<Product>(`/erp/products/${id}`, input);
export const adjustProductStock = (id: number, input: AdjustProductStockInput) => api.post<{ product: Product; movementId: number }>(`/erp/products/${id}/adjustments`, input);
/** The till scanned a code; the server does not care whose code it is. */
export const lookupProductByBarcode = (code: string, params: { branchId?: number } = {}) => (
  api.get<Product>(`/erp/products/by-barcode${query({ ...params, code })}`)
);
/** Gives a product that arrived without a code one of ours to print. */
export const generateProductBarcode = (id: number, params: { branchId?: number } = {}) => (
  api.post<Product>(`/erp/products/${id}/barcode`, params)
);
export type StockMovementReason = NonNullable<ListStockMovementsQuery['reason']>;
export const listStockMovements = async (params: { branchId?: number; productId?: number; reason?: StockMovementReason; page?: number; pageSize?: number } = {}) => {
  const result = await api.getPage<StockMovement>(`/erp/products/movements${query(params)}`);
  return { ...result, totalPages: result.meta.totalPages };
};

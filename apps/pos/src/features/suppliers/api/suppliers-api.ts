import type { CancelPurchaseInput, CreatePurchaseInput, CreateSupplierInput, UpdateSupplierInput } from '@capella/contracts';
import { api } from '@/lib/api/client';

export interface Supplier { id: number; branchId: number; name: string; phone: string | null; notes: string | null; isActive: boolean; createdAt: string; updatedAt: string }
export interface PurchaseLine { id: number; purchaseId: number; branchId: number; productId: number; productNameSnapshot: string; quantity: number; unitCost: string; previousUnitCost: string; lineTotal: string; postedBalanceAfter: number; cancellationBalanceAfter: number | null }
export interface Purchase { id: number; branchId: number; supplierId: number; supplierName: string; status: 'posted' | 'cancelled'; purchaseDate: string; total: string; actingAccountId: number; actingUsername: string; cancelledAt: string | null; cancelledByAccountId: number | null; cancellationReason: string | null; correctsPurchaseId: number | null; correctedByPurchaseId: number | null; createdAt: string; lines: PurchaseLine[] }
const query = (params: Record<string, unknown>) => { const result = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') result.set(key, String(value)); }); return result.size ? `?${result}` : ''; };
export const listSuppliers = (params: { branchId?: number; search?: string; isActive?: boolean; page?: number; pageSize?: number } = {}) => api.getPage<Supplier>(`/erp/suppliers${query(params)}`);
export const listAllSuppliers = async (params: { branchId?: number; search?: string; isActive?: boolean } = {}) => {
  const pageSize = 100; const first = await listSuppliers({ ...params, page: 1, pageSize }); const items = [...first.items];
  for (let page = 2; page <= first.meta.totalPages; page += 1) items.push(...(await listSuppliers({ ...params, page, pageSize })).items);
  return { ...first, items };
};
export const createSupplier = (input: CreateSupplierInput) => api.post<Supplier>('/erp/suppliers', input);
export const updateSupplier = (id: number, input: UpdateSupplierInput) => api.patch<Supplier>(`/erp/suppliers/${id}`, input);
export const listPurchases = (params: { branchId?: number; supplierId?: number; productId?: number; status?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) => api.getPage<Purchase>(`/erp/suppliers/purchases${query(params)}`);
export const postPurchase = (input: CreatePurchaseInput) => api.post<Purchase>('/erp/suppliers/purchases', input);
export const cancelPurchase = (id: number, input: CancelPurchaseInput) => api.post<Purchase>(`/erp/suppliers/purchases/${id}/cancel`, input);

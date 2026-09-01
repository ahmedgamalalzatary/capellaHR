import type { CompleteServiceExecutionsInput, ConfigureConsumableInput, CorrectServiceExecutionInput, TransferConsumableStockInput } from '@capella/contracts';
import { api } from '@/lib/api/client';
const query = (params: Record<string, string | number | undefined>) => { const value = new URLSearchParams(); Object.entries(params).forEach(([key, entry]) => { if (entry !== undefined && entry !== '') value.set(key, String(entry)); }); return value.size ? `?${value}` : ''; };
export interface ConsumableBalance { productId: number; productName: string; unit: 'ml' | 'gm'; packageSize: string; consumableQuantity: string; sellableQuantity: number; lastPurchaseCost: string }
export interface ConsumableServiceExecution { id: number; status: 'pending' | 'completed' | 'overdue'; queueNumber: number; cashierSessionId: number; invoiceId: number; invoiceNumber: string; clientName: string | null; clientPhone: string | null; serviceId: number; serviceName: string; employeeId: number | null; employeeName: string | null; createdAt: string; completedAt: string | null }
export const listConsumableBalances = (params: { branchId?: number; search?: string; page?: number; pageSize?: number } = {}) => api.getPage<ConsumableBalance>(`/erp/consumables${query(params)}`);
export const configureConsumable = (productId: number, input: ConfigureConsumableInput) => api.put(`/erp/consumables/products/${productId}/configuration`, input);
export const transferConsumableStock = (productId: number, input: TransferConsumableStockInput) => api.post(`/erp/consumables/products/${productId}/transfers`, input);
export const listConsumableServices = (params: { branchId?: number; status?: string; cashierSessionId?: number; search?: string; page?: number; pageSize?: number } = {}) => api.getPage<ConsumableServiceExecution>(`/erp/consumables/services${query(params)}`);
export const completeServiceExecutions = (input: CompleteServiceExecutionsInput) => api.post('/erp/consumables/services/complete', input);
export const correctServiceExecution = (id: number, input: CorrectServiceExecutionInput) => api.put(`/erp/consumables/services/${id}`, input);

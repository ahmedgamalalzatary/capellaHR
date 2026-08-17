import type { CreateStockTransferInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

export interface StockTransferLine {
  sourceProductId: number;
  destinationProductId: number;
  productName: string;
  quantity: number;
  unitCost: string;
  lineTotal: string;
}

export interface StockTransfer {
  id: number;
  sourceBranchId: number;
  sourceBranchName: string;
  destinationBranchId: number;
  destinationBranchName: string;
  invoiceId: number;
  invoiceNumber: string;
  transferDate: string;
  totalCost: string;
  note: string | null;
  actingAccountId: number;
  createdAt: string;
  lines: StockTransferLine[];
}

const query = (params: Record<string, string | number | undefined>) => {
  const value = new URLSearchParams();
  for (const [key, entry] of Object.entries(params)) {
    if (entry !== undefined && entry !== '') value.set(key, String(entry));
  }
  return value.size ? `?${value}` : '';
};

export const createStockTransfer = (input: CreateStockTransferInput) => (
  api.post<StockTransfer>('/erp/stock-transfers', input)
);

export const listStockTransfers = (params: {
  branchId?: number;
  productId?: number;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
} = {}) => api.getPage<StockTransfer>(`/erp/stock-transfers${query(params)}`);

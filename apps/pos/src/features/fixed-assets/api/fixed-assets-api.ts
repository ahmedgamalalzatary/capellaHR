import type { CreateFixedAssetInput, FixedAssetCondition, UpdateFixedAssetInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

/** A line of the branch's fixed-assets register; only the name is ever certain. */
export type FixedAsset = {
  id: number;
  branchId: number;
  name: string;
  quantity: number | null;
  unitPrice: string | null;
  location: string;
  note: string;
  purchasedOn: string | null;
  condition: FixedAssetCondition | null;
  actingAccountId: number;
  actingUsername: string;
  createdAt: string;
  updatedAt: string;
};
export type ListFixedAssetParams = { branchId?: number; search?: string; page?: number; pageSize?: number };

const query = (params: Record<string, string | number | undefined>) => {
  const value = new URLSearchParams();
  for (const [key, entry] of Object.entries(params)) if (entry !== undefined && entry !== '') value.set(key, String(entry));
  const serialized = value.toString();
  return serialized ? `?${serialized}` : '';
};

export const listFixedAssets = (params: ListFixedAssetParams = {}) => api.getPage<FixedAsset>(`/erp/fixed-assets${query(params)}`);
export const createFixedAsset = (input: CreateFixedAssetInput) => api.post<FixedAsset>('/erp/fixed-assets', input);
/** A whole-line replacement: whatever the form does not carry is cleared. */
export const updateFixedAsset = (id: number, input: UpdateFixedAssetInput) => api.put<FixedAsset>(`/erp/fixed-assets/${id}`, input);
export const deleteFixedAsset = (id: number, branchId?: number) => api.delete<void>(`/erp/fixed-assets/${id}${query({ branchId })}`);

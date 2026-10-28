import { api } from '@/lib/api/client';

export interface BranchLink {
  id: number;
  senderBranchId: number;
  senderBranchName: string;
  receiverBranchId: number;
  receiverBranchName: string;
  state: 'pending' | 'active';
  createdAt: string;
  updatedAt: string;
}
export interface SyncCandidate { id: number; name: string; barcode: string | null }
export type SyncRowKind = 'auto' | 'linked' | 'excluded' | 'ambiguous' | 'barcode_mismatch' | 'only_in_sender' | 'receiver_taken';
export interface SyncSetupRow {
  senderProductId: number;
  name: string;
  description: string | null;
  barcode: string | null;
  state: 'green' | 'conflict';
  kind: SyncRowKind;
  receiverProductId: number | null;
  candidates: SyncCandidate[];
}
export interface SyncSetup {
  link: BranchLink;
  rows: SyncSetupRow[];
  receiverProducts: SyncCandidate[];
  allGreen: boolean;
}
export interface SyncExcludedRow {
  senderProductId: number;
  name: string;
  notSameAs: SyncCandidate | null;
}
export type SettleSyncInput =
  | { action: 'link'; receiverProductId: number }
  | { action: 'exclude'; notSameAsProductId: number | null }
  | { action: 'create'; name: string };

export const listBranchLinks = () => api.get<BranchLink[]>('/erp/product-sync');
export const createBranchLink = (input: { senderBranchId: number; receiverBranchId: number }) => (
  api.post<BranchLink>('/erp/product-sync', input)
);
export const getSyncSetup = (id: number) => api.get<SyncSetup>(`/erp/product-sync/${id}/setup`);
export const settleSyncRow = (id: number, productId: number, input: SettleSyncInput) => (
  api.put<SyncSetup>(`/erp/product-sync/${id}/rows/${productId}`, input)
);
export const activateBranchLink = (id: number) => api.post<SyncSetup>(`/erp/product-sync/${id}/activation`);
export const listExcludedProducts = (id: number) => api.get<SyncExcludedRow[]>(`/erp/product-sync/${id}/excluded`);
export const deleteBranchLink = (id: number) => api.delete<void>(`/erp/product-sync/${id}`);

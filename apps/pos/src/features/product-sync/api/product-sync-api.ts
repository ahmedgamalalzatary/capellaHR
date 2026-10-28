import { api } from '@/lib/api/client';
import type { ConfirmBranchLinkInput } from '@capella/contracts';

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

export interface SyncIssue {
  id: number;
  linkId: number | null;
  senderBranchId: number;
  senderBranchName: string;
  receiverBranchId: number;
  receiverBranchName: string;
  senderProductId: number;
  productName: string;
  reason: 'name_clash' | 'copy_failed';
  createdAt: string;
}
export type SettleIssueInput = SettleSyncInput | { action: 'retry' };

export const listBranchLinks = () => api.get<BranchLink[]>('/erp/product-sync');
export const createBranchLink = (input: { senderBranchId: number; receiverBranchId: number }) => (
  api.post<BranchLink>('/erp/product-sync', input)
);
export const getSyncSetup = (id: number) => api.get<SyncSetup>(`/erp/product-sync/${id}/setup`);
export const settleSyncRow = (id: number, productId: number, input: SettleSyncInput) => (
  api.put<SyncSetup>(`/erp/product-sync/${id}/rows/${productId}`, input)
);
export const activateBranchLink = (id: number, input: ConfirmBranchLinkInput = { decisions: [] }) => (
  api.post<SyncSetup>(`/erp/product-sync/${id}/activation`, input)
);
export const listExcludedProducts = (id: number) => api.get<SyncExcludedRow[]>(`/erp/product-sync/${id}/excluded`);
export const deleteBranchLink = (id: number) => api.delete<void>(`/erp/product-sync/${id}`);
/** The "needs attention" list: products a sending branch could not place. */
export const listSyncIssues = () => api.get<SyncIssue[]>('/erp/product-sync/issues');
export const settleSyncIssue = (issueId: number, input: SettleIssueInput) => (
  api.put<SyncIssue[]>(`/erp/product-sync/issues/${issueId}`, input)
);
/** Products linked to another branch, to badge them in the products list. */
export const listLinkedProductIds = (branchId: number) => (
  api.get<number[]>(`/erp/product-sync/linked?branchId=${branchId}`)
);

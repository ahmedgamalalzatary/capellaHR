import type { CreateBranchInput, UpdateBranchInput } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

export interface Branch {
  id: number;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  attendanceRadiusMeters: number;
  hasEverBeenReferenced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListBranchesParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listBranches(params: ListBranchesParams = {}): Promise<{ items: Branch[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<Branch>(`/branches${suffix}`);
}

export function createBranch(input: CreateBranchInput): Promise<Branch> {
  return api.post<Branch>('/branches', input);
}

export function updateBranch(id: number, input: UpdateBranchInput): Promise<Branch> {
  return api.patch<Branch>(`/branches/${id}`, input);
}

export function deleteBranch(id: number): Promise<void> {
  return api.delete<void>(`/branches/${id}`);
}

import type { ErpCategoryType } from '@capella/contracts';

import { api } from '@/lib/api/client';

export interface Category {
  id: number;
  branchId: number;
  type: ErpCategoryType;
  name: string;
  isActive: boolean;
  /** True once a service (or, later, an expense) has used it: deletion is then refused. */
  hasEverBeenReferenced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: number;
  branchId: number;
  categoryId: number;
  name: string;
  description: string | null;
  /** Exact fixed EGP price, or null when the seller must price the service. */
  price: string | null;
  commissionPercent: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Browsing also needs the category label and whether the category itself is retired. */
export type ServiceListItem = Service & { categoryName: string; categoryIsActive: boolean };

export interface CommissionOverride {
  id: number;
  serviceId: number;
  employeeId: number;
  commissionPercent: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogBranch { id: number; name: string }
export interface CatalogEmployeeOption { id: number; fullName: string }

/** Admins act on a named branch; a cashier's branch comes from their account. */
export interface BranchScoped { branchId?: number }

const queryString = (params: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
};

export interface ListCategoriesParams extends BranchScoped {
  search?: string;
  type?: ErpCategoryType;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export function listCategories(params: ListCategoriesParams = {}) {
  return api.getPage<Category>(`/erp/categories${queryString({ ...params })}`);
}

export function createCategory(input: { name: string; type: ErpCategoryType } & BranchScoped) {
  return api.post<Category>('/erp/categories', input);
}

export function updateCategory(
  id: number,
  input: { name?: string; isActive?: boolean } & BranchScoped,
) {
  return api.patch<Category>(`/erp/categories/${id}`, input);
}

export function deleteCategory(id: number, branchId?: number) {
  return api.delete<void>(`/erp/categories/${id}${queryString({ branchId })}`);
}

export interface ListServicesParams extends BranchScoped {
  search?: string;
  categoryId?: number;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export function listServices(params: ListServicesParams = {}) {
  return api.getPage<ServiceListItem>(`/erp/services${queryString({ ...params })}`);
}

export function createService(input: {
  name: string;
  categoryId: number;
  price: string | null;
  commissionPercent: string;
  description?: string | null;
} & BranchScoped) {
  return api.post<Service>('/erp/services', input);
}

export function updateService(id: number, input: {
  name?: string;
  categoryId?: number;
  price?: string | null;
  commissionPercent?: string;
  description?: string | null;
  isActive?: boolean;
} & BranchScoped) {
  return api.patch<Service>(`/erp/services/${id}`, input);
}

export function listCommissionOverrides(serviceId: number, branchId?: number) {
  return api.get<CommissionOverride[]>(
    `/erp/services/${serviceId}/commission-overrides${queryString({ branchId })}`,
  );
}

export function setCommissionOverride(
  serviceId: number,
  input: { employeeId: number; commissionPercent: string } & BranchScoped,
) {
  return api.put<CommissionOverride>(`/erp/services/${serviceId}/commission-overrides`, input);
}

export function removeCommissionOverride(
  serviceId: number,
  employeeId: number,
  branchId?: number,
) {
  return api.delete<void>(
    `/erp/services/${serviceId}/commission-overrides/${employeeId}${queryString({ branchId })}`,
  );
}

/** Admin-only: the branch an Admin acts on must be named explicitly. */
export function listCatalogBranches(page = 1) {
  return api.getPage<CatalogBranch>(`/branches?page=${page}&pageSize=100`);
}

/** Admin-only: candidates for a per-employee commission override. */
export function listCatalogEmployeeOptions(page = 1, branchId?: number) {
  return api.getPage<CatalogEmployeeOption>(
    `/employees${queryString({ status: 'active', branchId, page })}`,
  );
}

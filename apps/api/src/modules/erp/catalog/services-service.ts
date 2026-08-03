import type { ListServicesQuery } from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity, ErpEmployeeCapability } from '../hr-capabilities.js';
import { catalogError, isDuplicateEntryError } from './catalog-errors.js';
import {
  assertCatalogAdmin,
  normalizeCatalogName,
  type CategoryRepository,
} from './categories-service.js';

export type ServiceRecord = {
  id: number;
  branchId: number;
  categoryId: number;
  name: string;
  description: string | null;
  /** Exact EGP decimal string; never a float. */
  price: string;
  /** Exact percentage of the pre-discount list price. */
  commissionPercent: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Browsing needs the category label and whether the category itself is retired. */
export type ServiceListItem = ServiceRecord & {
  categoryName: string;
  categoryIsActive: boolean;
};

export type CommissionOverrideRecord = {
  id: number;
  serviceId: number;
  employeeId: number;
  commissionPercent: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ServiceWrite = {
  branchId: number;
  categoryId: number;
  name: string;
  nameNormalized: string;
  description: string | null;
  price: string;
  commissionPercent: string;
};

export type ServiceChanges = {
  categoryId?: number;
  name?: string;
  nameNormalized?: string;
  description?: string | null;
  price?: string;
  commissionPercent?: string;
  isActive?: boolean;
};

export interface ServiceRepository {
  create(input: ServiceWrite): Promise<ServiceRecord>;
  findById(id: number): Promise<ServiceRecord | null>;
  findByNormalizedName(branchId: number, nameNormalized: string): Promise<ServiceRecord | null>;
  list(
    branchId: number,
    query: ListServicesQuery,
  ): Promise<{ items: ServiceListItem[]; total: number }>;
  update(id: number, branchId: number, changes: ServiceChanges): Promise<ServiceRecord | null>;
  listOverrides(serviceId: number): Promise<CommissionOverrideRecord[]>;
  setOverride(
    serviceId: number,
    employeeId: number,
    commissionPercent: string,
  ): Promise<CommissionOverrideRecord>;
  deleteOverride(serviceId: number, employeeId: number): Promise<boolean>;
}

/**
 * There is deliberately no delete operation: an invoice line snapshots the
 * service name, price and commission rate at sale time and points back at this
 * row, so retiring a service is `isActive = false` and nothing else.
 */
export const createServiceCatalogService = (dependencies: {
  repository: ServiceRepository;
  categories: Pick<CategoryRepository, 'findById'>;
  employees: ErpEmployeeCapability;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const { repository, categories, employees, resolveBranchContext } = dependencies;

  const readInBranch = async (branchId: number, id: number) => {
    const record = await repository.findById(id);
    if (!record || record.branchId !== branchId) throw catalogError('SERVICE_NOT_FOUND');
    return record;
  };

  /** A service may only sit under an active service-type category of its branch. */
  const requireServiceCategory = async (branchId: number, categoryId: number) => {
    const category = await categories.findById(categoryId);
    if (!category || category.branchId !== branchId) throw catalogError('CATEGORY_NOT_FOUND');
    if (category.type !== 'service') throw catalogError('CATEGORY_TYPE_INVALID');
    if (!category.isActive) throw catalogError('CATEGORY_INACTIVE');
    return category;
  };

  const rejectDuplicate = async (branchId: number, nameNormalized: string, allowedId?: number) => {
    const existing = await repository.findByNormalizedName(branchId, nameNormalized);
    if (existing && existing.id !== allowedId) {
      throw catalogError('SERVICE_NAME_EXISTS', existing.id);
    }
  };

  const asConflict = async (
    branchId: number,
    nameNormalized: string,
    error: unknown,
  ): Promise<never> => {
    if (!isDuplicateEntryError(error)) throw error;
    const existing = await repository.findByNormalizedName(branchId, nameNormalized);
    throw catalogError('SERVICE_NAME_EXISTS', existing?.id);
  };

  /**
   * Reported as missing rather than forbidden for an employee of another branch,
   * so the override endpoint cannot be used to enumerate other branches' staff.
   */
  const requireBranchEmployee = async (branchId: number, employeeId: number) => {
    const employee = await employees.findActiveById(employeeId);
    if (!employee || employee.branchId !== branchId) {
      throw catalogError('CATALOG_EMPLOYEE_NOT_FOUND');
    }
    return employee;
  };

  return {
    async create(
      actor: ErpAccountIdentity,
      input: {
        name: string;
        categoryId: number;
        price: string;
        commissionPercent: string;
        description?: string | null | undefined;
        branchId?: number | undefined;
      },
    ) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      await requireServiceCategory(branchId, input.categoryId);

      const name = input.name.trim();
      const nameNormalized = normalizeCatalogName(name);
      await rejectDuplicate(branchId, nameNormalized);
      try {
        return await repository.create({
          branchId,
          categoryId: input.categoryId,
          name,
          nameNormalized,
          description: input.description ?? null,
          price: input.price,
          commissionPercent: input.commissionPercent,
        });
      } catch (error) {
        return await asConflict(branchId, nameNormalized, error);
      }
    },

    async get(actor: ErpAccountIdentity, id: number, requestedBranchId?: number) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      return readInBranch(branchId, id);
    },

    async list(actor: ErpAccountIdentity, query: ListServicesQuery) {
      const { branchId } = await resolveBranchContext(actor, query.branchId);
      return repository.list(branchId, query);
    },

    async update(
      actor: ErpAccountIdentity,
      id: number,
      input: {
        name?: string | undefined;
        categoryId?: number | undefined;
        price?: string | undefined;
        commissionPercent?: string | undefined;
        description?: string | null | undefined;
        isActive?: boolean | undefined;
        branchId?: number | undefined;
      },
    ) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      await readInBranch(branchId, id);

      const changes: ServiceChanges = {};
      if (input.categoryId !== undefined) {
        await requireServiceCategory(branchId, input.categoryId);
        changes.categoryId = input.categoryId;
      }
      if (input.price !== undefined) changes.price = input.price;
      if (input.commissionPercent !== undefined) changes.commissionPercent = input.commissionPercent;
      if (input.isActive !== undefined) changes.isActive = input.isActive;
      if (input.description !== undefined) changes.description = input.description;
      if (input.name !== undefined) {
        const name = input.name.trim();
        const nameNormalized = normalizeCatalogName(name);
        await rejectDuplicate(branchId, nameNormalized, id);
        changes.name = name;
        changes.nameNormalized = nameNormalized;
      }

      let record: ServiceRecord | null;
      try {
        record = await repository.update(id, branchId, changes);
      } catch (error) {
        return await asConflict(branchId, changes.nameNormalized ?? '', error);
      }
      if (!record) throw catalogError('SERVICE_NOT_FOUND');
      return record;
    },

    async listCommissionOverrides(
      actor: ErpAccountIdentity,
      serviceId: number,
      requestedBranchId?: number,
    ) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      await readInBranch(branchId, serviceId);
      return repository.listOverrides(serviceId);
    },

    async setCommissionOverride(
      actor: ErpAccountIdentity,
      serviceId: number,
      input: { employeeId: number; commissionPercent: string; branchId?: number | undefined },
    ) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      await readInBranch(branchId, serviceId);
      await requireBranchEmployee(branchId, input.employeeId);
      return repository.setOverride(serviceId, input.employeeId, input.commissionPercent);
    },

    async removeCommissionOverride(
      actor: ErpAccountIdentity,
      serviceId: number,
      employeeId: number,
      requestedBranchId?: number,
    ) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      await readInBranch(branchId, serviceId);
      if (!await repository.deleteOverride(serviceId, employeeId)) {
        throw catalogError('COMMISSION_OVERRIDE_NOT_FOUND');
      }
    },
  };
};

export type ServiceCatalogService = ReturnType<typeof createServiceCatalogService>;

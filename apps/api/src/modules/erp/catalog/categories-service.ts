import type { ErpCategoryType, ListCategoriesQuery } from '@capella/contracts';
import { createHash } from 'node:crypto';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { catalogError, isDuplicateEntryError } from './catalog-errors.js';

export type CategoryRecord = {
  id: number;
  branchId: number;
  type: ErpCategoryType;
  name: string;
  isActive: boolean;
  /** Permanently true once a service (or, from ERP 15, an expense) points here. */
  hasEverBeenReferenced: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CategoryWrite = {
  branchId: number;
  type: ErpCategoryType;
  name: string;
  nameNormalized: string;
};

export type CategoryChanges = { name?: string; nameNormalized?: string; isActive?: boolean };

export interface CategoryRepository {
  create(input: CategoryWrite): Promise<CategoryRecord>;
  findById(id: number): Promise<CategoryRecord | null>;
  findByNormalizedName(
    branchId: number,
    type: ErpCategoryType,
    nameNormalized: string,
  ): Promise<CategoryRecord | null>;
  list(
    branchId: number,
    query: ListCategoriesQuery,
  ): Promise<{ items: CategoryRecord[]; total: number }>;
  update(id: number, branchId: number, changes: CategoryChanges): Promise<CategoryRecord | null>;
  /** Deletion is refused once anything has referenced the category. */
  delete(id: number, branchId: number): Promise<'deleted' | 'referenced' | 'missing'>;
}

/** Same normalization the Branches module uses, so duplicate detection matches. */
export const normalizeCatalogName = (name: string) => (
  createHash('sha256').update(name.trim().toLowerCase()).digest('hex')
);

/**
 * Catalog administration is Admin work: a Cashier may browse the catalog but
 * never change what is sellable or what it costs.
 */
export const assertCatalogAdmin = (actor: ErpAccountIdentity) => {
  if (actor.role !== 'admin') throw catalogError('ERP_CATALOG_ADMIN_REQUIRED');
};

export const createCategoryService = (dependencies: {
  repository: CategoryRepository;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const { repository, resolveBranchContext } = dependencies;

  /**
   * A category outside the acting branch is reported as missing rather than
   * forbidden, so nobody can probe another branch's catalog by id.
   */
  const readInBranch = async (branchId: number, id: number) => {
    const record = await repository.findById(id);
    if (!record || record.branchId !== branchId) throw catalogError('CATEGORY_NOT_FOUND');
    return record;
  };

  const rejectDuplicate = async (
    branchId: number,
    type: ErpCategoryType,
    nameNormalized: string,
    allowedId?: number,
  ) => {
    const existing = await repository.findByNormalizedName(branchId, type, nameNormalized);
    if (existing && existing.id !== allowedId) {
      throw catalogError('CATEGORY_NAME_EXISTS', existing.id);
    }
  };

  const asConflict = async (
    branchId: number,
    type: ErpCategoryType,
    nameNormalized: string,
    error: unknown,
  ): Promise<never> => {
    if (!isDuplicateEntryError(error)) throw error;
    const existing = await repository.findByNormalizedName(branchId, type, nameNormalized);
    throw catalogError('CATEGORY_NAME_EXISTS', existing?.id);
  };

  return {
    async create(
      actor: ErpAccountIdentity,
      input: { name: string; type: ErpCategoryType; branchId?: number | undefined },
    ) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      const name = input.name.trim();
      const nameNormalized = normalizeCatalogName(name);
      await rejectDuplicate(branchId, input.type, nameNormalized);
      try {
        return await repository.create({ branchId, type: input.type, name, nameNormalized });
      } catch (error) {
        return await asConflict(branchId, input.type, nameNormalized, error);
      }
    },

    async get(actor: ErpAccountIdentity, id: number, requestedBranchId?: number) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      return readInBranch(branchId, id);
    },

    async list(actor: ErpAccountIdentity, query: ListCategoriesQuery) {
      const { branchId } = await resolveBranchContext(actor, query.branchId);
      return repository.list(branchId, query);
    },

    async update(
      actor: ErpAccountIdentity,
      id: number,
      // Explicit `| undefined` because the API compiles with exactOptionalPropertyTypes.
      input: { name?: string | undefined; isActive?: boolean | undefined; branchId?: number | undefined },
    ) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      const current = await readInBranch(branchId, id);

      const changes: CategoryChanges = {};
      if (input.isActive !== undefined) changes.isActive = input.isActive;
      if (input.name !== undefined) {
        const name = input.name.trim();
        const nameNormalized = normalizeCatalogName(name);
        await rejectDuplicate(branchId, current.type, nameNormalized, id);
        changes.name = name;
        changes.nameNormalized = nameNormalized;
      }

      let record: CategoryRecord | null;
      try {
        record = await repository.update(id, branchId, changes);
      } catch (error) {
        return await asConflict(branchId, current.type, changes.nameNormalized ?? '', error);
      }
      if (!record) throw catalogError('CATEGORY_NOT_FOUND');
      return record;
    },

    /**
     * Deletion exists only for a category nothing ever used. Once a service (or
     * later an expense) has pointed at it, the row carries history and may only
     * be deactivated.
     */
    async remove(actor: ErpAccountIdentity, id: number, requestedBranchId?: number) {
      assertCatalogAdmin(actor);
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      const outcome = await repository.delete(id, branchId);
      if (outcome === 'referenced') throw catalogError('CATEGORY_IN_USE');
      if (outcome === 'missing') throw catalogError('CATEGORY_NOT_FOUND');
    },
  };
};

export type CategoryService = ReturnType<typeof createCategoryService>;

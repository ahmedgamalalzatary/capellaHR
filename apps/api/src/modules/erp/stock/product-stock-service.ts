import type {
  AdjustProductStockInput,
  ListProductsQuery,
  ListStockMovementsQuery,
  UpdateProductInput,
} from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { normalizeCatalogName } from '../catalog/index.js';

export type ProductStockRecord = {
  id: number;
  branchId: number;
  name: string;
  description: string | null;
  sellingPrice: string;
  lastPurchaseCost: string;
  lowStockThreshold: number;
  isActive: boolean;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
};
export type ProductStockWrite = Omit<ProductStockRecord, 'id' | 'quantity' | 'createdAt' | 'updatedAt'> & {
  nameNormalized: string;
  openingQuantity: number;
};
export type ProductStockChanges = Partial<Pick<ProductStockWrite,
  'name' | 'nameNormalized' | 'description' | 'sellingPrice' | 'lastPurchaseCost' | 'lowStockThreshold' | 'isActive'>>;
export type StockMovementRecord = {
  id: number; productId: number; branchId: number; reason: string; sourceType: string;
  sourceId: number | null; quantityDelta: number; balanceAfter: number;
  actingAccountId: number; note: string | null; createdAt: Date;
  productName: string; actingUsername: string;
};

export interface ProductStockRepository {
  create(input: ProductStockWrite, actingAccountId: number): Promise<ProductStockRecord>;
  findById(id: number): Promise<ProductStockRecord | null>;
  findByNormalizedName(branchId: number, nameNormalized: string): Promise<ProductStockRecord | null>;
  list(branchId: number, query: ListProductsQuery): Promise<{ items: ProductStockRecord[]; total: number }>;
  update(id: number, branchId: number, changes: ProductStockChanges, actingAccountId: number): Promise<ProductStockRecord | null>;
  adjust(id: number, branchId: number, input: AdjustProductStockInput, actingAccountId: number): Promise<{ product: ProductStockRecord; movementId: number }>;
  listMovements(branchId: number, query: ListStockMovementsQuery): Promise<{ items: StockMovementRecord[]; total: number }>;
}

export type ProductStockErrorCode = 'PRODUCT_NOT_FOUND' | 'PRODUCT_NAME_EXISTS' | 'INSUFFICIENT_STOCK';
export class ProductStockError extends Error {
  constructor(public readonly code: ProductStockErrorCode, message: string, public readonly existingId?: number) {
    super(message);
    this.name = 'ProductStockError';
  }
}
const messages: Record<ProductStockErrorCode, string> = {
  PRODUCT_NOT_FOUND: 'المنتج غير موجود',
  PRODUCT_NAME_EXISTS: 'اسم المنتج مستخدم بالفعل',
  INSUFFICIENT_STOCK: 'الكمية المتاحة غير كافية',
};
const error = (code: ProductStockErrorCode, existingId?: number) => new ProductStockError(code, messages[code], existingId);
const isDuplicate = (value: unknown) => typeof value === 'object' && value !== null && (
  Reflect.get(value, 'code') === 'ER_DUP_ENTRY' || Reflect.get(Reflect.get(value, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY'
);

export const createProductStockService = (dependencies: {
  repository: ProductStockRepository;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const { repository, resolveBranchContext } = dependencies;
  const inBranch = async (branchId: number, id: number) => {
    const record = await repository.findById(id);
    if (!record || record.branchId !== branchId) throw error('PRODUCT_NOT_FOUND');
    return record;
  };
  const rejectDuplicate = async (branchId: number, normalized: string, allowedId?: number) => {
    const existing = await repository.findByNormalizedName(branchId, normalized);
    if (existing && existing.id !== allowedId) throw error('PRODUCT_NAME_EXISTS', existing.id);
  };
  return {
    async create(actor: ErpAccountIdentity, input: {
      branchId?: number | undefined; name: string; description?: string | null | undefined; sellingPrice: string;
      lastPurchaseCost: string; lowStockThreshold: number;
    }) {
      const context = await resolveBranchContext(actor, input.branchId);
      const name = input.name.trim();
      const nameNormalized = normalizeCatalogName(name);
      await rejectDuplicate(context.branchId, nameNormalized);
      try {
        return await repository.create({
          branchId: context.branchId, name, nameNormalized, description: input.description ?? null,
          sellingPrice: input.sellingPrice, lastPurchaseCost: input.lastPurchaseCost,
          lowStockThreshold: input.lowStockThreshold, isActive: true, openingQuantity: 0,
        }, context.accountId);
      } catch (cause) {
        if (!isDuplicate(cause)) throw cause;
        const existing = await repository.findByNormalizedName(context.branchId, nameNormalized);
        throw error('PRODUCT_NAME_EXISTS', existing?.id);
      }
    },
    async get(actor: ErpAccountIdentity, id: number, requestedBranchId?: number) {
      const context = await resolveBranchContext(actor, requestedBranchId);
      return inBranch(context.branchId, id);
    },
    async list(actor: ErpAccountIdentity, query: ListProductsQuery) {
      const context = await resolveBranchContext(actor, query.branchId);
      return repository.list(context.branchId, query);
    },
    async update(actor: ErpAccountIdentity, id: number, input: UpdateProductInput) {
      const context = await resolveBranchContext(actor, input.branchId);
      await inBranch(context.branchId, id);
      const changes: ProductStockChanges = {};
      if (input.name !== undefined) {
        changes.name = input.name.trim();
        changes.nameNormalized = normalizeCatalogName(changes.name);
        await rejectDuplicate(context.branchId, changes.nameNormalized, id);
      }
      if (input.description !== undefined) changes.description = input.description;
      if (input.sellingPrice !== undefined) changes.sellingPrice = input.sellingPrice;
      if (input.lastPurchaseCost !== undefined) changes.lastPurchaseCost = input.lastPurchaseCost;
      if (input.lowStockThreshold !== undefined) changes.lowStockThreshold = input.lowStockThreshold;
      if (input.isActive !== undefined) changes.isActive = input.isActive;
      try {
        const result = await repository.update(id, context.branchId, changes, context.accountId);
        if (!result) throw error('PRODUCT_NOT_FOUND');
        return result;
      } catch (cause) {
        if (!isDuplicate(cause)) throw cause;
        const existing = await repository.findByNormalizedName(context.branchId, changes.nameNormalized ?? '');
        throw error('PRODUCT_NAME_EXISTS', existing?.id);
      }
    },
    async adjust(actor: ErpAccountIdentity, id: number, input: AdjustProductStockInput) {
      const context = await resolveBranchContext(actor, input.branchId);
      await inBranch(context.branchId, id);
      return repository.adjust(id, context.branchId, input, context.accountId);
    },
    async listMovements(actor: ErpAccountIdentity, query: ListStockMovementsQuery) {
      const context = await resolveBranchContext(actor, query.branchId);
      return repository.listMovements(context.branchId, query);
    },
  };
};

export type ProductStockService = ReturnType<typeof createProductStockService>;

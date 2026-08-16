import type { CancelPurchaseInput, CreatePurchaseInput, ListPurchasesQuery, ListSuppliersQuery, UpdateSupplierInput } from '@capella/contracts';
import { createHash } from 'node:crypto';

import type { ErpBranchContextResolver } from '../branch-context.js';
import { normalizeCatalogName } from '../catalog/index.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

export type SupplierRecord = { id: number; branchId: number; name: string; phone: string | null; notes: string | null; isActive: boolean; createdAt: Date; updatedAt: Date };
export type PurchaseLineRecord = { id: number; purchaseId: number; branchId: number; productId: number; productNameSnapshot: string; quantity: number; unitCost: string; previousUnitCost: string; lineTotal: string; postedBalanceAfter: number | null; cancellationBalanceAfter: number | null };
export type PurchaseRecord = {
  id: number; branchId: number; supplierId: number; supplierName: string; status: 'posted' | 'cancelled'; purchaseDate: string; total: string;
  actingAccountId: number; actingUsername: string; cancelledAt: Date | null; cancelledByAccountId: number | null;
  cancellationReason: string | null; correctsPurchaseId: number | null; correctedByPurchaseId: number | null; createdAt: Date; lines: PurchaseLineRecord[];
};
export type PurchasePostWrite = {
  branchId: number; idempotencyKey: string; idempotencyFingerprint: string; supplierId: number; purchaseDate: string; total: string; correctsPurchaseId: number | null;
  lines: Array<{ productId: number; quantity: number; unitCost: string; lineTotal: string }>;
};
export interface SupplierPurchaseRepository {
  createSupplier(input: { branchId: number; name: string; nameNormalized: string; phone: string | null; notes: string | null }, actingAccountId: number): Promise<SupplierRecord>;
  findSupplierById(id: number): Promise<SupplierRecord | null>;
  findSupplierByNormalizedName(branchId: number, nameNormalized: string): Promise<SupplierRecord | null>;
  listSuppliers(branchId: number, query: ListSuppliersQuery): Promise<{ items: SupplierRecord[]; total: number }>;
  updateSupplier(id: number, branchId: number, changes: Partial<Pick<SupplierRecord, 'name' | 'phone' | 'notes' | 'isActive'>> & { nameNormalized?: string }, actingAccountId: number): Promise<SupplierRecord | null>;
  postPurchase(input: PurchasePostWrite, actingAccountId: number): Promise<PurchaseRecord>;
  findPurchase(id: number, branchId: number): Promise<PurchaseRecord | null>;
  listPurchases(branchId: number, query: ListPurchasesQuery): Promise<{ items: PurchaseRecord[]; total: number }>;
  cancelPurchase(id: number, branchId: number, reason: string, actingAccountId: number): Promise<PurchaseRecord>;
}

export type PurchaseErrorCode = 'SUPPLIER_NOT_FOUND' | 'SUPPLIER_INACTIVE' | 'SUPPLIER_NAME_EXISTS' | 'PURCHASE_NOT_FOUND' | 'PURCHASE_ALREADY_CANCELLED' | 'PURCHASE_CORRECTION_INVALID' | 'PURCHASE_IDEMPOTENCY_CONFLICT' | 'PURCHASE_PRODUCT_NOT_FOUND' | 'PURCHASE_PRODUCT_INACTIVE' | 'PURCHASE_CANCELLATION_UNSAFE' | 'PURCHASE_STOCK_OVERFLOW';
export class PurchaseError extends Error { constructor(public readonly code: PurchaseErrorCode, message: string, public readonly existingId?: number) { super(message); this.name = 'PurchaseError'; } }
const messages: Record<PurchaseErrorCode, string> = {
  SUPPLIER_NOT_FOUND: 'المورد غير موجود',
  SUPPLIER_INACTIVE: 'المورد غير نشط', SUPPLIER_NAME_EXISTS: 'اسم المورد مستخدم بالفعل', PURCHASE_NOT_FOUND: 'المشتريات غير موجودة',
  PURCHASE_ALREADY_CANCELLED: 'تم إلغاء المشتريات من قبل', PURCHASE_CORRECTION_INVALID: 'مرجع التصحيح غير صالح أو سبق تصحيحه',
  PURCHASE_IDEMPOTENCY_CONFLICT: 'مفتاح إعادة المحاولة مستخدم لمشتريات مختلفة',
  PURCHASE_PRODUCT_NOT_FOUND: 'أحد المنتجات غير موجود', PURCHASE_PRODUCT_INACTIVE: 'أحد المنتجات غير نشط',
  PURCHASE_CANCELLATION_UNSAFE: 'لا يمكن الإلغاء لأن المخزون الحالي لا يكفي لعكس الكميات',
  PURCHASE_STOCK_OVERFLOW: 'لا يمكن ترحيل الكمية لأنها تتجاوز الحد الأقصى للمخزون',
};
export const purchaseError = (code: PurchaseErrorCode, existingId?: number) => new PurchaseError(code, messages[code], existingId);
export const isSupplierDuplicateEntryError = (value: unknown) => {
  if (typeof value !== 'object' || value === null) return false;
  if (Reflect.get(value, 'code') === 'ER_DUP_ENTRY') return true;
  const cause: unknown = Reflect.get(value, 'cause');
  return typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ER_DUP_ENTRY';
};
const cents = (money: string) => {
  if (!/^\d+\.\d{2}$/.test(money)) throw new TypeError('Money must use exactly two decimal places');
  return BigInt(money.replace('.', ''));
};
const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

export const createSupplierPurchaseService = ({ repository, resolveBranchContext }: { repository: SupplierPurchaseRepository; resolveBranchContext: ErpBranchContextResolver }) => {
  const context = (actor: ErpAccountIdentity, branchId?: number) => resolveBranchContext(actor, branchId);
  const supplierInBranch = async (branchId: number, id: number) => {
    const record = await repository.findSupplierById(id);
    if (!record || record.branchId !== branchId) throw purchaseError('SUPPLIER_NOT_FOUND');
    return record;
  };
  return {
    async createSupplier(actor: ErpAccountIdentity, input: { branchId?: number | undefined; name: string; phone?: string | null | undefined; notes?: string | null | undefined }) {
      const branch = await context(actor, input.branchId); const name = input.name.trim(); const nameNormalized = normalizeCatalogName(name);
      const existing = await repository.findSupplierByNormalizedName(branch.branchId, nameNormalized);
      if (existing) throw purchaseError('SUPPLIER_NAME_EXISTS', existing.id);
      try { return await repository.createSupplier({ branchId: branch.branchId, name, nameNormalized, phone: input.phone ?? null, notes: input.notes ?? null }, branch.accountId); }
      catch (cause) { if (!isSupplierDuplicateEntryError(cause)) throw cause; throw purchaseError('SUPPLIER_NAME_EXISTS', (await repository.findSupplierByNormalizedName(branch.branchId, nameNormalized))?.id); }
    },
    async getSupplier(actor: ErpAccountIdentity, id: number, branchId?: number) { const branch = await context(actor, branchId); return supplierInBranch(branch.branchId, id); },
    async listSuppliers(actor: ErpAccountIdentity, query: ListSuppliersQuery) { const branch = await context(actor, query.branchId); return repository.listSuppliers(branch.branchId, query); },
    async updateSupplier(actor: ErpAccountIdentity, id: number, input: UpdateSupplierInput) {
      const branch = await context(actor, input.branchId); await supplierInBranch(branch.branchId, id); const changes: Parameters<SupplierPurchaseRepository['updateSupplier']>[2] = {};
      if (input.name !== undefined) { changes.name = input.name.trim(); changes.nameNormalized = normalizeCatalogName(changes.name); const existing = await repository.findSupplierByNormalizedName(branch.branchId, changes.nameNormalized); if (existing && existing.id !== id) throw purchaseError('SUPPLIER_NAME_EXISTS', existing.id); }
      if (input.phone !== undefined) changes.phone = input.phone; if (input.notes !== undefined) changes.notes = input.notes; if (input.isActive !== undefined) changes.isActive = input.isActive;
      try { const result = await repository.updateSupplier(id, branch.branchId, changes, branch.accountId); if (!result) throw purchaseError('SUPPLIER_NOT_FOUND'); return result; }
      catch (cause) { if (!isSupplierDuplicateEntryError(cause)) throw cause; throw purchaseError('SUPPLIER_NAME_EXISTS'); }
    },
    async postPurchase(actor: ErpAccountIdentity, input: CreatePurchaseInput) {
      const branch = await context(actor, input.branchId);
      const lines = input.lines.map((line) => ({ ...line, lineTotal: money(cents(line.unitCost) * BigInt(line.quantity)) }));
      const total = money(lines.reduce((sum, line) => sum + cents(line.lineTotal), 0n));
      const fingerprintFacts = { branchId: branch.branchId, supplierId: input.supplierId, purchaseDate: input.purchaseDate, total, correctsPurchaseId: input.correctsPurchaseId ?? null, lines: [...lines].sort((a, b) => a.productId - b.productId) };
      const idempotencyFingerprint = createHash('sha256').update(JSON.stringify(fingerprintFacts)).digest('hex');
      return repository.postPurchase({ ...fingerprintFacts, idempotencyKey: input.idempotencyKey, idempotencyFingerprint }, branch.accountId);
    },
    async getPurchase(actor: ErpAccountIdentity, id: number, branchId?: number) { const branch = await context(actor, branchId); const result = await repository.findPurchase(id, branch.branchId); if (!result) throw purchaseError('PURCHASE_NOT_FOUND'); return result; },
    async listPurchases(actor: ErpAccountIdentity, query: ListPurchasesQuery) { const branch = await context(actor, query.branchId); return repository.listPurchases(branch.branchId, query); },
    async cancelPurchase(actor: ErpAccountIdentity, id: number, input: CancelPurchaseInput) { const branch = await context(actor, input.branchId); return repository.cancelPurchase(id, branch.branchId, input.reason, branch.accountId); },
  };
};
export type SupplierPurchaseService = ReturnType<typeof createSupplierPurchaseService>;

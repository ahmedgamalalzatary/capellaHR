import { type createDatabase } from '@capella/database';
import { accounts, erpProducts, erpProductStocks, erpPurchaseLines, erpPurchases, erpStockMovements, erpSuppliers } from '@capella/database/schema';
import { and, asc, count, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { isSupplierDuplicateEntryError, purchaseError, type PurchaseLineRecord, type PurchaseRecord, type SupplierPurchaseRepository } from './suppliers-service.js';

type Database = ReturnType<typeof createDatabase>;
const supplierScope = (id: number, branchId: number) => and(eq(erpSuppliers.id, id), eq(erpSuppliers.branchId, branchId));
const purchaseSelection = { id: erpPurchases.id, branchId: erpPurchases.branchId, supplierId: erpPurchases.supplierId, supplierName: erpPurchases.supplierNameSnapshot, status: erpPurchases.status, purchaseDate: erpPurchases.purchaseDate, total: erpPurchases.total, actingAccountId: erpPurchases.actingAccountId, actingUsername: accounts.username, cancelledAt: erpPurchases.cancelledAt, cancelledByAccountId: erpPurchases.cancelledByAccountId, cancellationReason: erpPurchases.cancellationReason, correctsPurchaseId: erpPurchases.correctsPurchaseId, createdAt: erpPurchases.createdAt };
const lineSelection = { id: erpPurchaseLines.id, purchaseId: erpPurchaseLines.purchaseId, branchId: erpPurchaseLines.branchId, productId: erpPurchaseLines.productId, productNameSnapshot: erpPurchaseLines.productNameSnapshot, quantity: erpPurchaseLines.quantity, unitCost: erpPurchaseLines.unitCost, previousUnitCost: erpPurchaseLines.previousUnitCost, lineTotal: erpPurchaseLines.lineTotal };

export const createDrizzleSupplierPurchaseRepository = (database: Database, audit: ErpAuditCapability, now: () => Date = () => new Date()): SupplierPurchaseRepository => {
  const hydrate = async (rows: Array<Omit<PurchaseRecord, 'lines' | 'correctedByPurchaseId'>>, executor: Pick<Database, 'select'> = database) => {
    if (!rows.length) return [];
    const lines = await executor.select(lineSelection).from(erpPurchaseLines).where(inArray(erpPurchaseLines.purchaseId, rows.map((row) => row.id))).orderBy(asc(erpPurchaseLines.id)) as Array<Omit<PurchaseLineRecord, 'postedBalanceAfter' | 'cancellationBalanceAfter'>>;
    const movements = await executor.select({ sourceId: erpStockMovements.sourceId, productId: erpStockMovements.productId, sourceType: erpStockMovements.sourceType, balanceAfter: erpStockMovements.balanceAfter }).from(erpStockMovements).where(and(
      inArray(erpStockMovements.sourceId, rows.map((row) => row.id)),
      inArray(erpStockMovements.sourceType, ['purchase', 'purchase_cancellation']),
    ));
    const corrections = await executor.select({ id: erpPurchases.id, correctsPurchaseId: erpPurchases.correctsPurchaseId }).from(erpPurchases).where(inArray(erpPurchases.correctsPurchaseId, rows.map((row) => row.id)));
    return rows.map((row) => ({
      ...row,
      correctedByPurchaseId: corrections.find((entry) => entry.correctsPurchaseId === row.id)?.id ?? null,
      lines: lines.filter((line) => line.purchaseId === row.id).map((line) => ({
        ...line,
        postedBalanceAfter: movements.find((entry) => entry.sourceId === row.id && entry.productId === line.productId && entry.sourceType === 'purchase')?.balanceAfter ?? null,
        cancellationBalanceAfter: movements.find((entry) => entry.sourceId === row.id && entry.productId === line.productId && entry.sourceType === 'purchase_cancellation')?.balanceAfter ?? null,
      })),
    }));
  };
  const findPurchase = async (id: number, branchId: number) => {
    const row = (await database.select(purchaseSelection).from(erpPurchases).innerJoin(accounts, eq(accounts.id, erpPurchases.actingAccountId)).where(and(eq(erpPurchases.id, id), eq(erpPurchases.branchId, branchId), ne(erpPurchases.status, 'posting'))).limit(1))[0] as Omit<PurchaseRecord, 'lines' | 'correctedByPurchaseId'> | undefined;
    return row ? (await hydrate([row]))[0]! : null;
  };
  return {
    async createSupplier(input, actingAccountId) { return database.transaction(async (tx) => { const at = now(); const inserted = await tx.insert(erpSuppliers).values({ ...input, createdAt: at, updatedAt: at }); const id = Number(inserted[0].insertId); const record = (await tx.select().from(erpSuppliers).where(eq(erpSuppliers.id, id)).limit(1))[0]!; await audit.record(tx, { module: 'erp-purchases', action: 'create', entityType: 'supplier', entityId: id, afterState: record, relatedIds: { branchId: input.branchId, actingAccountId }, createdAt: at }); return record; }); },
    async findSupplierById(id) { return (await database.select().from(erpSuppliers).where(eq(erpSuppliers.id, id)).limit(1))[0] ?? null; },
    async findSupplierByNormalizedName(branchId, nameNormalized) { return (await database.select().from(erpSuppliers).where(and(eq(erpSuppliers.branchId, branchId), eq(erpSuppliers.nameNormalized, nameNormalized))).limit(1))[0] ?? null; },
    async listSuppliers(branchId, query) { const filters = [eq(erpSuppliers.branchId, branchId)]; if (query.isActive !== undefined) filters.push(eq(erpSuppliers.isActive, query.isActive)); if (query.search) filters.push(or(sql`locate(${query.search}, ${erpSuppliers.name}) > 0`, sql`locate(${query.search}, ${erpSuppliers.phone}) > 0`)!); const where = and(...filters); const items = await database.select().from(erpSuppliers).where(where).orderBy(asc(erpSuppliers.name), asc(erpSuppliers.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize); const totals = await database.select({ value: count() }).from(erpSuppliers).where(where); return { items, total: totals[0]?.value ?? 0 }; },
    async updateSupplier(id, branchId, changes, actingAccountId) { return database.transaction(async (tx) => { const scope = supplierScope(id, branchId); const before = (await tx.select().from(erpSuppliers).where(scope).for('update').limit(1))[0]; if (!before) return null; const at = now(); await tx.update(erpSuppliers).set({ ...changes, updatedAt: at }).where(scope); const after = (await tx.select().from(erpSuppliers).where(scope).limit(1))[0]!; await audit.record(tx, { module: 'erp-purchases', action: 'update', entityType: 'supplier', entityId: id, beforeState: before, afterState: after, relatedIds: { branchId, actingAccountId }, createdAt: at }); return after; }); },
    async postPurchase(input, actingAccountId) {
      const replay = async () => {
        const existing = (await database.select({ id: erpPurchases.id, branchId: erpPurchases.branchId, actingAccountId: erpPurchases.actingAccountId, fingerprint: erpPurchases.idempotencyFingerprint }).from(erpPurchases).where(eq(erpPurchases.idempotencyKey, input.idempotencyKey)).limit(1))[0];
        if (!existing) return null;
        if (existing.branchId !== input.branchId || existing.actingAccountId !== actingAccountId || existing.fingerprint !== input.idempotencyFingerprint) throw purchaseError('PURCHASE_IDEMPOTENCY_CONFLICT');
        return findPurchase(existing.id, input.branchId);
      };
      const replayed = await replay(); if (replayed) return replayed;
      let id: number;
      try { id = await database.transaction(async (tx) => {
        const supplier = (await tx.select().from(erpSuppliers).where(supplierScope(input.supplierId, input.branchId)).for('update').limit(1))[0]; if (!supplier) throw purchaseError('SUPPLIER_NOT_FOUND'); if (!supplier.isActive) throw purchaseError('SUPPLIER_INACTIVE');
        if (input.correctsPurchaseId !== null) { const original = (await tx.select().from(erpPurchases).where(and(eq(erpPurchases.id, input.correctsPurchaseId), eq(erpPurchases.branchId, input.branchId))).for('update').limit(1))[0]; if (!original || original.status !== 'cancelled' || original.supplierId !== input.supplierId) throw purchaseError('PURCHASE_CORRECTION_INVALID'); const used = (await tx.select({ id: erpPurchases.id }).from(erpPurchases).where(and(eq(erpPurchases.branchId, input.branchId), eq(erpPurchases.correctsPurchaseId, input.correctsPurchaseId))).limit(1))[0]; if (used) throw purchaseError('PURCHASE_CORRECTION_INVALID'); }
        const at = now(); const inserted = await tx.insert(erpPurchases).values({ branchId: input.branchId, supplierId: input.supplierId, supplierNameSnapshot: supplier.name, idempotencyKey: input.idempotencyKey, idempotencyFingerprint: input.idempotencyFingerprint, status: 'posting', purchaseDate: input.purchaseDate, total: input.total, actingAccountId, correctsPurchaseId: input.correctsPurchaseId, createdAt: at }); const purchaseId = Number(inserted[0].insertId);
        for (const line of [...input.lines].sort((a, b) => a.productId - b.productId)) { const product = (await tx.select().from(erpProducts).where(and(eq(erpProducts.id, line.productId), eq(erpProducts.branchId, input.branchId))).for('update').limit(1))[0]; if (!product) throw purchaseError('PURCHASE_PRODUCT_NOT_FOUND'); if (!product.isActive) throw purchaseError('PURCHASE_PRODUCT_INACTIVE'); const stockScope = and(eq(erpProductStocks.productId, line.productId), eq(erpProductStocks.branchId, input.branchId)); const stock = (await tx.select().from(erpProductStocks).where(stockScope).for('update').limit(1))[0]; if (!stock) throw purchaseError('PURCHASE_PRODUCT_NOT_FOUND'); if (line.quantity > 2_147_483_647 - stock.quantity) throw purchaseError('PURCHASE_STOCK_OVERFLOW'); const balanceAfter = stock.quantity + line.quantity; await tx.insert(erpPurchaseLines).values({ purchaseId, branchId: input.branchId, productId: line.productId, productNameSnapshot: product.name, quantity: line.quantity, unitCost: line.unitCost, previousUnitCost: product.lastPurchaseCost, lineTotal: line.lineTotal }); await tx.update(erpProductStocks).set({ quantity: balanceAfter, updatedAt: at }).where(stockScope); await tx.update(erpProducts).set({ lastPurchaseCost: line.unitCost, updatedAt: at }).where(and(eq(erpProducts.id, line.productId), eq(erpProducts.branchId, input.branchId))); await tx.insert(erpStockMovements).values({ productId: line.productId, branchId: input.branchId, reason: 'purchase', sourceType: 'purchase', sourceId: purchaseId, quantityDelta: line.quantity, balanceAfter, actingAccountId, createdAt: at }); }
        await tx.update(erpPurchases).set({ status: 'posted' }).where(eq(erpPurchases.id, purchaseId));
        const postedRow = (await tx.select(purchaseSelection).from(erpPurchases).innerJoin(accounts, eq(accounts.id, erpPurchases.actingAccountId)).where(and(eq(erpPurchases.id, purchaseId), eq(erpPurchases.branchId, input.branchId))).limit(1))[0] as Omit<PurchaseRecord, 'lines' | 'correctedByPurchaseId'>;
        const posted = (await hydrate([postedRow], tx))[0]!;
        await audit.record(tx, { module: 'erp-purchases', action: 'post', entityType: 'purchase', entityId: purchaseId, afterState: posted, relatedIds: { branchId: input.branchId, supplierId: input.supplierId, actingAccountId }, createdAt: at }); return purchaseId;
      }); } catch (cause) { if (!isSupplierDuplicateEntryError(cause)) throw cause; const result = await replay(); if (result) return result; throw cause; }
      return (await findPurchase(id, input.branchId))!;
    },
    findPurchase,
    async listPurchases(branchId, query) { const filters = [eq(erpPurchases.branchId, branchId), ne(erpPurchases.status, 'posting')]; if (query.supplierId !== undefined) filters.push(eq(erpPurchases.supplierId, query.supplierId)); if (query.status !== undefined) filters.push(eq(erpPurchases.status, query.status)); if (query.from) filters.push(gte(erpPurchases.purchaseDate, query.from)); if (query.to) filters.push(lte(erpPurchases.purchaseDate, query.to)); if (query.productId !== undefined) filters.push(sql`exists (select 1 from erp_purchase_lines where erp_purchase_lines.purchase_id = ${erpPurchases.id} and erp_purchase_lines.product_id = ${query.productId})`); const where = and(...filters); const rows = await database.select(purchaseSelection).from(erpPurchases).innerJoin(accounts, eq(accounts.id, erpPurchases.actingAccountId)).where(where).orderBy(desc(erpPurchases.purchaseDate), desc(erpPurchases.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize) as Array<Omit<PurchaseRecord, 'lines' | 'correctedByPurchaseId'>>; const totals = await database.select({ value: count() }).from(erpPurchases).where(where); return { items: await hydrate(rows), total: totals[0]?.value ?? 0 }; },
    async cancelPurchase(id, branchId, reason, actingAccountId) {
      await database.transaction(async (tx) => {
        const at = now();
        const purchase = (await tx.select().from(erpPurchases).where(and(eq(erpPurchases.id, id), eq(erpPurchases.branchId, branchId))).for('update').limit(1))[0];
        if (!purchase) throw purchaseError('PURCHASE_NOT_FOUND');
        if (purchase.status === 'cancelled') throw purchaseError('PURCHASE_ALREADY_CANCELLED');
        const lines = await tx.select().from(erpPurchaseLines).where(eq(erpPurchaseLines.purchaseId, id)).orderBy(asc(erpPurchaseLines.productId));
        for (const line of lines) {
          const productScope = and(eq(erpProducts.id, line.productId), eq(erpProducts.branchId, branchId));
          const product = (await tx.select().from(erpProducts).where(productScope).for('update').limit(1))[0];
          const stockScope = and(eq(erpProductStocks.productId, line.productId), eq(erpProductStocks.branchId, branchId));
          const stock = (await tx.select().from(erpProductStocks).where(stockScope).for('update').limit(1))[0];
          if (!product || !stock || stock.quantity < line.quantity) throw purchaseError('PURCHASE_CANCELLATION_UNSAFE');
          const balanceAfter = stock.quantity - line.quantity;
          const latestRemaining = (await tx.select({ unitCost: erpPurchaseLines.unitCost }).from(erpPurchaseLines).innerJoin(
            erpPurchases,
            and(eq(erpPurchases.id, erpPurchaseLines.purchaseId), eq(erpPurchases.branchId, erpPurchaseLines.branchId)),
          ).where(and(
            eq(erpPurchaseLines.productId, line.productId), eq(erpPurchaseLines.branchId, branchId),
            eq(erpPurchases.status, 'posted'), ne(erpPurchases.id, id),
          )).orderBy(desc(erpPurchases.createdAt), desc(erpPurchases.id)).limit(1))[0];
          const baseline = latestRemaining ? undefined : (await tx.select({ value: erpPurchaseLines.previousUnitCost }).from(erpPurchaseLines).innerJoin(
            erpPurchases,
            and(eq(erpPurchases.id, erpPurchaseLines.purchaseId), eq(erpPurchases.branchId, erpPurchaseLines.branchId)),
          ).where(and(eq(erpPurchaseLines.productId, line.productId), eq(erpPurchaseLines.branchId, branchId)))
            .orderBy(asc(erpPurchases.createdAt), asc(erpPurchases.id)).limit(1))[0];
          await tx.update(erpProductStocks).set({ quantity: balanceAfter, updatedAt: at }).where(stockScope);
          if (product.lastPurchaseCost === line.unitCost) {
            await tx.update(erpProducts).set({ lastPurchaseCost: latestRemaining?.unitCost ?? baseline?.value ?? line.previousUnitCost, updatedAt: at }).where(productScope);
          }
          await tx.insert(erpStockMovements).values({ productId: line.productId, branchId, reason: 'purchase_cancellation', sourceType: 'purchase_cancellation', sourceId: id, quantityDelta: -line.quantity, balanceAfter, actingAccountId, note: reason, createdAt: at });
        }
        await tx.update(erpPurchases).set({ status: 'cancelled', cancelledAt: at, cancelledByAccountId: actingAccountId, cancellationReason: reason }).where(eq(erpPurchases.id, id));
        await audit.record(tx, { module: 'erp-purchases', action: 'cancel', entityType: 'purchase', entityId: id, beforeState: purchase, afterState: { ...purchase, status: 'cancelled', cancellationReason: reason }, relatedIds: { branchId, actingAccountId }, createdAt: at });
      });
      return (await findPurchase(id, branchId))!;
    },
  };
};

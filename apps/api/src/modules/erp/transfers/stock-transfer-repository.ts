import { type createDatabase } from '@capella/database';
import {
  branches,
  clients,
  cashierSessions,
  erpProducts,
  erpProductStocks,
  erpStockMovements,
  erpStockTransferLines,
  erpStockTransfers,
  invoices,
} from '@capella/database/schema';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import type { SaleTransaction } from '../sales/index.js';
import {
  StockTransferError,
  type ApplyDestinationInput,
  type StockTransferRecord,
  type StockTransferRepository,
} from './stock-transfer-service.js';

type Database = ReturnType<typeof createDatabase>;
type Executor = Database | SaleTransaction;

const AUDIT_MODULE = 'erp-stock-transfers';
const isDuplicateEntry = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;
  if (Reflect.get(error, 'code') === 'ER_DUP_ENTRY') return true;
  const cause: unknown = Reflect.get(error, 'cause');
  return typeof cause === 'object' && cause !== null
    && Reflect.get(cause, 'code') === 'ER_DUP_ENTRY';
};
const toCents = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(2, '0').slice(0, 2)}`);
};
const fromCents = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

const hydrate = async (
  executor: Executor,
  transferId: number,
): Promise<StockTransferRecord | null> => {
  const row = (await executor.select({
    id: erpStockTransfers.id,
    sourceBranchId: erpStockTransfers.sourceBranchId,
    destinationBranchId: erpStockTransfers.destinationBranchId,
    invoiceId: erpStockTransfers.invoiceId,
    invoiceNumber: invoices.invoiceNumber,
    transferDate: erpStockTransfers.transferDate,
    totalCost: erpStockTransfers.totalCost,
    note: erpStockTransfers.note,
    actingAccountId: erpStockTransfers.actingAccountId,
    createdAt: erpStockTransfers.createdAt,
  }).from(erpStockTransfers)
    .innerJoin(invoices, eq(invoices.id, erpStockTransfers.invoiceId))
    .where(eq(erpStockTransfers.id, transferId)).limit(1))[0];
  if (!row || row.invoiceId === null) return null;

  const names = new Map((await executor.select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(inArray(branches.id, [row.sourceBranchId, row.destinationBranchId])))
    .map((branch) => [branch.id, branch.name]));
  const lines = await executor.select({
    sourceProductId: erpStockTransferLines.sourceProductId,
    destinationProductId: erpStockTransferLines.destinationProductId,
    productName: erpStockTransferLines.productNameSnapshot,
    quantity: erpStockTransferLines.quantity,
    unitCost: erpStockTransferLines.unitCost,
    lineTotal: erpStockTransferLines.lineTotal,
  }).from(erpStockTransferLines)
    .where(eq(erpStockTransferLines.transferId, transferId))
    .orderBy(asc(erpStockTransferLines.id));

  return {
    ...row,
    invoiceId: row.invoiceId,
    sourceBranchName: names.get(row.sourceBranchId) ?? '',
    destinationBranchName: names.get(row.destinationBranchId) ?? '',
    lines,
  };
};

export const createDrizzleStockTransferRepository = (
  database: Database,
  audit: ErpAuditCapability,
): StockTransferRepository => ({
  async findByIdempotencyKey(key) {
    const row = (await database.select({ id: erpStockTransfers.id }).from(erpStockTransfers)
      .where(and(
        eq(erpStockTransfers.idempotencyKey, key),
        eq(erpStockTransfers.status, 'posted'),
      )).limit(1))[0];
    return row ? hydrate(database, row.id) : null;
  },

  async readSourceProducts(branchId, productIds) {
    if (!productIds.length) return [];
    return database.select({
      id: erpProducts.id,
      name: erpProducts.name,
      unitCost: erpProducts.lastPurchaseCost,
      quantity: erpProductStocks.quantity,
      isActive: erpProducts.isActive,
    }).from(erpProducts).innerJoin(erpProductStocks, and(
      eq(erpProductStocks.productId, erpProducts.id),
      eq(erpProductStocks.branchId, erpProducts.branchId),
    )).where(and(
      eq(erpProducts.branchId, branchId),
      inArray(erpProducts.id, productIds),
    )).orderBy(asc(erpProducts.id));
  },

  async ensureTransferClient(sourceBranchId, destinationBranchName, now) {
    const fullName = `تحويل مخزون — ${destinationBranchName}`;
    const existing = (await database.select({ id: clients.id }).from(clients).where(and(
      eq(clients.branchId, sourceBranchId),
      eq(clients.fullName, fullName),
    )).limit(1))[0];
    if (existing) return existing.id;

    const inserted = await database.insert(clients).values({
      branchId: sourceBranchId, fullName, phone: null, createdAt: now, updatedAt: now,
    });
    return Number(inserted[0].insertId);
  },

  async findOpenSession(branchId) {
    const row = (await database.select({ id: cashierSessions.id }).from(cashierSessions).where(and(
      eq(cashierSessions.branchId, branchId),
      isNull(cashierSessions.closedAt),
    )).limit(1))[0];
    return row ?? null;
  },

  async applyDestination(transaction: SaleTransaction, input: ApplyDestinationInput) {
    const total = input.lines.reduce(
      (sum, line) => sum + toCents(line.unitCost) * BigInt(line.quantity),
      0n,
    );
    const inserted = await transaction.insert(erpStockTransfers).values({
      sourceBranchId: input.sourceBranchId,
      destinationBranchId: input.destinationBranchId,
      invoiceId: input.invoiceId,
      idempotencyKey: input.idempotencyKey,
      transferDate: input.transferDate,
      totalCost: fromCents(total),
      actingAccountId: input.actingAccountId,
      note: input.note,
      createdAt: input.postedAt,
    });
    const transferId = Number(inserted[0].insertId);

    const sources = new Map((await transaction.select({
      id: erpProducts.id,
      name: erpProducts.name,
      nameNormalized: erpProducts.nameNormalized,
      description: erpProducts.description,
      sellingPrice: erpProducts.sellingPrice,
      lowStockThreshold: erpProducts.lowStockThreshold,
    }).from(erpProducts).where(and(
      eq(erpProducts.branchId, input.sourceBranchId),
      inArray(erpProducts.id, input.lines.map(({ productId }) => productId)),
    ))).map((product) => [product.id, product]));

    // Destination rows are located by normalized name, so locking in that order
    // — not in source-id order — is what stops two transfers into the same
    // branch from taking the same two rows in opposite orders and deadlocking.
    const ordered = [...input.lines].sort((left, right) => (
      sources.get(left.productId)!.nameNormalized
        .localeCompare(sources.get(right.productId)!.nameNormalized)
    ));

    for (const line of ordered) {
      const source = sources.get(line.productId)!;
      const scope = and(
        eq(erpProducts.branchId, input.destinationBranchId),
        eq(erpProducts.nameNormalized, source.nameNormalized),
      );
      let destination = (await transaction.select({
        id: erpProducts.id,
        isActive: erpProducts.isActive,
        lastPurchaseCost: erpProducts.lastPurchaseCost,
      }).from(erpProducts).where(scope).for('update').limit(1))[0];

      if (destination && !destination.isActive) {
        throw new StockTransferError('TRANSFER_DESTINATION_PRODUCT_INACTIVE');
      }
      if (!destination) {
        // The receiving branch keeps its own price later; it starts from ours.
        // Locking a row that does not exist yet only holds a gap, so a
        // simultaneous first transfer of the same name can win the insert: take
        // its row rather than failing the whole sale on a duplicate key.
        try {
          const created = await transaction.insert(erpProducts).values({
            branchId: input.destinationBranchId,
            name: source.name,
            nameNormalized: source.nameNormalized,
            description: source.description,
            sellingPrice: source.sellingPrice,
            lastPurchaseCost: line.unitCost,
            lowStockThreshold: source.lowStockThreshold,
            createdAt: input.postedAt,
            updatedAt: input.postedAt,
          });
          destination = {
            id: Number(created[0].insertId), isActive: true, lastPurchaseCost: line.unitCost,
          };
        } catch (error) {
          if (!isDuplicateEntry(error)) throw error;
          destination = (await transaction.select({
            id: erpProducts.id,
            isActive: erpProducts.isActive,
            lastPurchaseCost: erpProducts.lastPurchaseCost,
          }).from(erpProducts).where(scope).for('update').limit(1))[0]!;
          if (!destination.isActive) {
            throw new StockTransferError('TRANSFER_DESTINATION_PRODUCT_INACTIVE');
          }
        }
      }

      const stockScope = and(
        eq(erpProductStocks.productId, destination.id),
        eq(erpProductStocks.branchId, input.destinationBranchId),
      );
      const stock = (await transaction.select({ quantity: erpProductStocks.quantity })
        .from(erpProductStocks).where(stockScope).for('update').limit(1))[0];
      const balanceAfter = (stock?.quantity ?? 0) + line.quantity;
      if (stock) {
        await transaction.update(erpProductStocks)
          .set({ quantity: balanceAfter, updatedAt: input.postedAt }).where(stockScope);
      } else {
        // A product the receiving branch has never held has no balance row yet.
        await transaction.insert(erpProductStocks).values({
          productId: destination.id,
          branchId: input.destinationBranchId,
          quantity: balanceAfter,
          updatedAt: input.postedAt,
        });
      }
      // The receiving branch's cost follows the goods; its price does not.
      await transaction.update(erpProducts)
        .set({ lastPurchaseCost: line.unitCost, updatedAt: input.postedAt })
        .where(eq(erpProducts.id, destination.id));

      await transaction.insert(erpStockTransferLines).values({
        transferId,
        sourceBranchId: input.sourceBranchId,
        destinationBranchId: input.destinationBranchId,
        sourceProductId: line.productId,
        destinationProductId: destination.id,
        productNameSnapshot: line.productName,
        quantity: line.quantity,
        unitCost: line.unitCost,
        previousDestinationCost: destination.lastPurchaseCost,
        lineTotal: fromCents(toCents(line.unitCost) * BigInt(line.quantity)),
      });
      await transaction.insert(erpStockMovements).values({
        productId: destination.id,
        branchId: input.destinationBranchId,
        reason: 'transfer_in',
        sourceType: 'transfer_in',
        sourceId: transferId,
        quantityDelta: line.quantity,
        balanceAfter,
        actingAccountId: input.actingAccountId,
        note: input.note,
        createdAt: input.postedAt,
      });
    }

    await transaction.update(erpStockTransfers).set({ status: 'posted' })
      .where(eq(erpStockTransfers.id, transferId));
    const record = (await hydrate(transaction, transferId))!;
    await audit.record(transaction, {
      module: AUDIT_MODULE,
      action: 'transfer',
      entityType: 'stock-transfer',
      entityId: transferId,
      afterState: record,
      relatedIds: {
        sourceBranchId: input.sourceBranchId,
        destinationBranchId: input.destinationBranchId,
        invoiceId: input.invoiceId,
        actingAccountId: input.actingAccountId,
      },
      createdAt: input.postedAt,
    });
    return record;
  },

  async list(query) {
    const filters = [eq(erpStockTransfers.status, 'posted' as const)];
    if (query.from) filters.push(gte(erpStockTransfers.transferDate, query.from));
    if (query.to) filters.push(lte(erpStockTransfers.transferDate, query.to));
    // Either side of the move counts as the branch's own transfer.
    if (query.branchId !== undefined) {
      filters.push(or(
        eq(erpStockTransfers.sourceBranchId, query.branchId),
        eq(erpStockTransfers.destinationBranchId, query.branchId),
      )!);
    }
    if (query.productId !== undefined) {
      filters.push(inArray(
        erpStockTransfers.id,
        database.select({ id: erpStockTransferLines.transferId }).from(erpStockTransferLines)
          .where(or(
            eq(erpStockTransferLines.sourceProductId, query.productId),
            eq(erpStockTransferLines.destinationProductId, query.productId),
          )),
      ));
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      database.select({ id: erpStockTransfers.id }).from(erpStockTransfers).where(where)
        .orderBy(desc(erpStockTransfers.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      database.select({ total: count() }).from(erpStockTransfers).where(where),
    ]);
    const items: StockTransferRecord[] = [];
    for (const row of rows) {
      const record = await hydrate(database, row.id);
      if (record) items.push(record);
    }
    return { items, total: totals[0]?.total ?? 0 };
  },
});

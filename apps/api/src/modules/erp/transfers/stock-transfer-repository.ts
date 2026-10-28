import { type createDatabase } from '@capella/database';
import {
  branches,
  clients,
  cashierSessions,
  erpBranchLinks,
  erpProducts,
  erpProductLinks,
  erpProductStocks,
  erpStockMovements,
  erpStockTransferLines,
  erpStockTransfers,
  invoices,
  invoiceLines,
} from '@capella/database/schema';
import type { BatchAllocation } from '@capella/contracts';
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

import { addBatchQuantities, createStockBatch, ensureLegacyBatch } from '../stock/index.js';

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
    requestedBatches: invoiceLines.requestedBatches,
    batches: erpStockTransferLines.batches,
    sourceProductId: erpStockTransferLines.sourceProductId,
    destinationProductId: erpStockTransferLines.destinationProductId,
    productName: erpStockTransferLines.productNameSnapshot,
    quantity: erpStockTransferLines.quantity,
    unitCost: erpStockTransferLines.unitCost,
    lineTotal: erpStockTransferLines.lineTotal,
  }).from(erpStockTransferLines)
    .leftJoin(invoiceLines, and(eq(invoiceLines.invoiceId, row.invoiceId), eq(invoiceLines.productId, erpStockTransferLines.sourceProductId), eq(invoiceLines.branchId, row.sourceBranchId)))
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
      matchKey: erpProducts.matchKey,
      barcode: erpProducts.barcode,
      commissionPercent: erpProducts.commissionPercent,
      description: erpProducts.description,
      sellingPrice: erpProducts.sellingPrice,
      lowStockThreshold: erpProducts.lowStockThreshold,
    }).from(erpProducts).where(and(
      eq(erpProducts.branchId, input.sourceBranchId),
      inArray(erpProducts.id, input.lines.map(({ productId }) => productId)),
    ))).map((product) => [product.id, product]));

    const sourceIds = [...sources.keys()];
    // Links are written in the branch link's direction (A product ⇒ B product),
    // so a transfer the other way finds its own row through the receiver side.
    const linkRows = await transaction.select({
      senderBranchId: erpProductLinks.senderBranchId,
      receiverBranchId: erpProductLinks.receiverBranchId,
      senderProductId: erpProductLinks.senderProductId,
      receiverProductId: erpProductLinks.receiverProductId,
      state: erpProductLinks.state,
      notSameAsProductId: erpProductLinks.notSameAsProductId,
    }).from(erpProductLinks).where(or(
      and(
        eq(erpProductLinks.senderBranchId, input.sourceBranchId),
        eq(erpProductLinks.receiverBranchId, input.destinationBranchId),
        inArray(erpProductLinks.senderProductId, sourceIds),
      ),
      and(
        eq(erpProductLinks.senderBranchId, input.destinationBranchId),
        eq(erpProductLinks.receiverBranchId, input.sourceBranchId),
        inArray(erpProductLinks.receiverProductId, sourceIds),
      ),
    ));

    const linkedTargets = new Map<number, number>();
    const excludedTargets = new Map<number, Set<number>>();
    for (const row of linkRows) {
      const forward = row.senderBranchId === input.sourceBranchId;
      const sourceProductId = forward ? row.senderProductId : row.receiverProductId;
      if (sourceProductId === null) continue;
      if (row.state === 'linked' && row.receiverProductId !== null) {
        linkedTargets.set(sourceProductId, forward ? row.receiverProductId : row.senderProductId);
      } else if (row.state === 'excluded' && row.notSameAsProductId !== null) {
        const blocked = excludedTargets.get(sourceProductId) ?? new Set<number>();
        blocked.add(row.notSameAsProductId);
        excludedTargets.set(sourceProductId, blocked);
      }
    }

    // Only an active link in the transfer's own direction may be recorded onto.
    const activeLink = (await transaction.select({ id: erpBranchLinks.id })
      .from(erpBranchLinks).where(and(
        eq(erpBranchLinks.senderBranchId, input.sourceBranchId),
        eq(erpBranchLinks.receiverBranchId, input.destinationBranchId),
        eq(erpBranchLinks.state, 'active' as const),
      )).limit(1))[0];

    // Locking order: a linked target is locked by its id, everyone else by the
    // key they will be looked up with. Deterministic, so two transfers into the
    // same branch take rows in the same order instead of deadlocking.
    const orderKey = (productId: number) => {
      const target = linkedTargets.get(productId);
      return target === undefined
        ? `1:${sources.get(productId)!.matchKey || sources.get(productId)!.nameNormalized}`
        : `0:${String(target).padStart(12, '0')}`;
    };
    const ordered = [...input.lines].sort((left, right) => (
      orderKey(left.productId).localeCompare(orderKey(right.productId))
    ));

    const settledInThisTransfer = new Set(linkRows
      .filter((row) => row.senderBranchId === input.sourceBranchId
        && row.receiverBranchId === input.destinationBranchId)
      .map((row) => row.senderProductId));

    const lockDestination = async (where: Parameters<typeof and>[0]) => (await transaction.select({
      id: erpProducts.id,
      isActive: erpProducts.isActive,
      awaitingFirstStock: erpProducts.awaitingFirstStock,
      lastPurchaseCost: erpProducts.lastPurchaseCost,
    }).from(erpProducts).where(and(where, eq(erpProducts.branchId, input.destinationBranchId)))
      .for('update').limit(4));

    const settle = (row: { id: number; isActive: boolean; awaitingFirstStock: boolean; lastPurchaseCost: string } | undefined) => {
      if (!row) return undefined;
      // Goods may land on a product waiting for its first stock; they may not
      // land on one someone turned off.
      if (!row.isActive && !row.awaitingFirstStock) {
        throw new StockTransferError('TRANSFER_DESTINATION_PRODUCT_INACTIVE');
      }
      return row;
    };

    for (const line of ordered) {
      const source = sources.get(line.productId)!;
      const blocked = excludedTargets.get(source.id) ?? new Set<number>();
      let destination: { id: number; isActive: boolean; awaitingFirstStock: boolean; lastPurchaseCost: string } | undefined;

      const linkedId = linkedTargets.get(source.id);
      if (linkedId !== undefined) {
        // The link is the answer, even if the receiving branch renamed the
        // product so nothing else would match.
        destination = settle(await lockDestination(eq(erpProducts.id, linkedId)).then((rows) => rows[0]));
        if (!destination) throw new StockTransferError('TRANSFER_DESTINATION_UNMATCHED');
      } else {
        // Barcode first: it is the strongest evidence two rows are one item, and
        // it also means an auto-created row can never duplicate a code.
        let matches = source.barcode
          ? await lockDestination(eq(erpProducts.barcode, source.barcode))
          : [];
        if (!matches.length && source.matchKey) {
          matches = await lockDestination(eq(erpProducts.matchKey, source.matchKey));
        }
        const valid = matches.filter((row) => !blocked.has(row.id));
        if (valid.length > 1) {
          // Two rows answer to the same name; picking one would be a guess.
          throw new StockTransferError('TRANSFER_DESTINATION_UNMATCHED');
        }
        if (valid.length === 1) destination = settle(valid[0]);
        else if (matches.length) {
          // Every match was ruled out as "not the same item". Creating around
          // the exclusion would resurrect the duplicate the admin refused.
          throw new StockTransferError('TRANSFER_DESTINATION_UNMATCHED');
        }
      }

      if (!destination) {
        // A new row for the receiving branch. It keeps that branch's own price
        // later; the barcode and commission travel with the goods.
        try {
          const created = await transaction.insert(erpProducts).values({
            branchId: input.destinationBranchId,
            name: source.name,
            nameNormalized: source.nameNormalized,
            matchKey: source.matchKey,
            barcode: source.barcode,
            commissionPercent: source.commissionPercent,
            description: source.description,
            sellingPrice: source.sellingPrice,
            lastPurchaseCost: line.unitCost,
            lowStockThreshold: source.lowStockThreshold,
            createdAt: input.postedAt,
            updatedAt: input.postedAt,
          });
          destination = {
            id: Number(created[0].insertId), isActive: true, awaitingFirstStock: false,
            lastPurchaseCost: line.unitCost,
          };
        } catch (error) {
          if (!isDuplicateEntry(error)) throw error;
          // Locking a row that does not exist yet only holds a gap, so a
          // simultaneous first transfer of the same name can win the insert:
          // take its row rather than failing the whole sale on a duplicate key.
          const clash = (await transaction.select({
            id: erpProducts.id,
            isActive: erpProducts.isActive,
            awaitingFirstStock: erpProducts.awaitingFirstStock,
            lastPurchaseCost: erpProducts.lastPurchaseCost,
          }).from(erpProducts).where(and(
            eq(erpProducts.branchId, input.destinationBranchId),
            eq(erpProducts.nameNormalized, source.nameNormalized),
          )).for('update').limit(1))[0];
          if (!clash) throw error;
          if (blocked.has(clash.id)) throw new StockTransferError('TRANSFER_DESTINATION_UNMATCHED');
          destination = settle(clash)!;
        }
      }

      if (!destination) throw new StockTransferError('TRANSFER_DESTINATION_UNMATCHED');

      if (activeLink && !settledInThisTransfer.has(source.id)) {
        const alreadyLinked = (await transaction.select({ id: erpProductLinks.id })
          .from(erpProductLinks).where(and(
            eq(erpProductLinks.senderBranchId, input.sourceBranchId),
            eq(erpProductLinks.receiverBranchId, input.destinationBranchId),
            eq(erpProductLinks.receiverProductId, destination.id),
          )).limit(1))[0];
        if (!alreadyLinked) {
          try {
            await transaction.insert(erpProductLinks).values({
              senderBranchId: input.sourceBranchId,
              receiverBranchId: input.destinationBranchId,
              senderProductId: source.id,
              receiverProductId: destination.id,
              state: 'linked' as const,
              notSameAsProductId: null,
              createdAt: input.postedAt,
              updatedAt: input.postedAt,
            });
            settledInThisTransfer.add(source.id);
          } catch (error) {
            // Another transfer settled the same pair first; its judgement is as
            // good as ours, and the sale must not roll back over it.
            if (!isDuplicateEntry(error)) throw error;
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
      await ensureLegacyBatch(transaction, destination.id, input.destinationBranchId, stock?.quantity ?? 0, '0.000', input.postedAt);
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
      // The receiving branch owns its own lots. Each sent allocation becomes a
      // fresh batch row here with the same expiry, so a later expiry fix in one
      // branch no longer changes the other.
      const received: BatchAllocation[] = [];
      for (const allocation of line.batches ?? []) {
        received.push({
          batchId: await createStockBatch(
            transaction, destination.id, input.destinationBranchId, allocation.expiryDate, input.postedAt,
          ),
          expiryDate: allocation.expiryDate,
          quantity: allocation.quantity,
        });
      }
      if (!received.length) {
        received.push({
          batchId: await createStockBatch(
            transaction, destination.id, input.destinationBranchId, null, input.postedAt,
          ),
          expiryDate: null,
          quantity: `${line.quantity}.000`,
        });
      }
      await addBatchQuantities(transaction, destination.id, input.destinationBranchId, received, 'quantity', input.postedAt);
      // The receiving branch's cost follows the goods; its price does not.
      await transaction.update(erpProducts)
        .set({ lastPurchaseCost: line.unitCost, updatedAt: input.postedAt })
        .where(eq(erpProducts.id, destination.id));

      await transaction.insert(erpStockTransferLines).values({
        batches: line.batches ?? null,
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
        batches: received,
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

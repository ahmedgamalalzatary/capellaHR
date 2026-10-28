import { type createDatabase } from '@capella/database';
import { branches, erpBranchLinks, erpProductLinks, erpProducts, erpProductStocks, erpProductSyncIssues } from '@capella/database/schema';
import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { CreateBranchLinkInput, SettleProductLinkInput } from '@capella/contracts';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { matchKeyFor, normalizeCatalogName } from '../catalog/index.js';
import type { ProductCopyInput, SyncCopyExecutor, SyncCopyRunner } from './product-copy-contract.js';
import {
  syncError,
  type BranchLinkRecord,
  type ProductSyncRepository,
  type SyncCandidate,
  type SyncExcludedRow,
  type SyncIssue,
  type SyncSetupRow,
} from './product-sync-service.js';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

const isDuplicateEntry = (error: unknown) => typeof error === 'object' && error !== null && (
  Reflect.get(error, 'code') === 'ER_DUP_ENTRY'
  || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY'
);

/** Raised inside a copy's savepoint so only that receiver is rolled back. */
class ProductCopyIssue extends Error {
  constructor(public readonly reason: 'name_clash') {
    super(reason);
    this.name = 'ProductCopyIssue';
  }
}

const copyReason = (error: unknown): 'name_clash' | 'copy_failed' => (
  error instanceof ProductCopyIssue ? error.reason
    : isDuplicateEntry(error) ? 'name_clash'
      : 'copy_failed'
);

const pairOf = (link: Pick<BranchLinkRecord, 'senderBranchId' | 'receiverBranchId'>) => and(
  eq(erpProductLinks.senderBranchId, link.senderBranchId),
  eq(erpProductLinks.receiverBranchId, link.receiverBranchId),
);

const linkSelection = {
  id: erpBranchLinks.id,
  senderBranchId: erpBranchLinks.senderBranchId,
  receiverBranchId: erpBranchLinks.receiverBranchId,
  state: erpBranchLinks.state,
  createdAt: erpBranchLinks.createdAt,
  updatedAt: erpBranchLinks.updatedAt,
};

const branchNames = async (executor: Executor, ids: number[]) => {
  if (!ids.length) return new Map<number, string>();
  const rows = await executor.select({ id: branches.id, name: branches.name })
    .from(branches).where(inArray(branches.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
};

/**
 * The rows of a setup, computed from the two catalogs as they are right now.
 * Nothing here is stored: only the Admin's answers are.
 */
const computeSetup = async (
  executor: Executor,
  link: Pick<BranchLinkRecord, 'senderBranchId' | 'receiverBranchId'>,
): Promise<{ rows: SyncSetupRow[]; receiverProducts: SyncCandidate[] }> => {
  const [senderProducts, receiverProducts, settled] = await Promise.all([
    executor.select({
      id: erpProducts.id,
      name: erpProducts.name,
      description: erpProducts.description,
      barcode: erpProducts.barcode,
      matchKey: erpProducts.matchKey,
    }).from(erpProducts).where(eq(erpProducts.branchId, link.senderBranchId))
      .orderBy(asc(erpProducts.name), asc(erpProducts.id)),
    executor.select({
      id: erpProducts.id, name: erpProducts.name, barcode: erpProducts.barcode, matchKey: erpProducts.matchKey,
    }).from(erpProducts).where(eq(erpProducts.branchId, link.receiverBranchId)),
    executor.select({
      senderProductId: erpProductLinks.senderProductId,
      receiverProductId: erpProductLinks.receiverProductId,
      state: erpProductLinks.state,
      notSameAsProductId: erpProductLinks.notSameAsProductId,
    }).from(erpProductLinks).where(pairOf(link)),
  ]);

  const byBarcode = new Map<string, SyncCandidate>();
  const byKey = new Map<string, SyncCandidate[]>();
  for (const product of receiverProducts) {
    if (product.barcode) byBarcode.set(product.barcode, product);
    byKey.set(product.matchKey, [...(byKey.get(product.matchKey) ?? []), product]);
  }

  const settledBySender = new Map(settled.map((row) => [row.senderProductId, row]));
  // A B product already taken in this pair cannot be offered to a second A
  // product: the link is one-to-one in both directions.
  const takenReceivers = new Set(
    settled.flatMap((row) => (row.receiverProductId === null ? [] : [row.receiverProductId])),
  );

  const rows = senderProducts.map((product): SyncSetupRow => {
    const answer = settledBySender.get(product.id);
    const base = {
      senderProductId: product.id,
      name: product.name,
      description: product.description,
      barcode: product.barcode,
    };
    if (answer) {
      return answer.state === 'linked' && answer.receiverProductId !== null
        ? { ...base, state: 'green', kind: 'linked', receiverProductId: answer.receiverProductId, candidates: [] }
        : { ...base, state: 'green', kind: 'excluded', receiverProductId: null, candidates: [] };
    }

    const barcodeMatch = product.barcode ? byBarcode.get(product.barcode) : undefined;
    if (barcodeMatch) {
      if (takenReceivers.has(barcodeMatch.id)) {
        return { ...base, state: 'conflict', kind: 'receiver_taken', receiverProductId: null, candidates: [barcodeMatch] };
      }
      return { ...base, state: 'green', kind: 'auto', receiverProductId: barcodeMatch.id, candidates: [] };
    }

    const matches = product.matchKey ? (byKey.get(product.matchKey) ?? []) : [];
    if (matches.length === 1) {
      const candidate = matches[0]!;
      if (takenReceivers.has(candidate.id)) {
        return { ...base, state: 'conflict', kind: 'receiver_taken', receiverProductId: null, candidates: [candidate] };
      }
      // Row 2: same name, but the two boxes carry different codes. Only the
      // Admin can say whether they are the same item.
      if (product.barcode && candidate.barcode && product.barcode !== candidate.barcode) {
        return { ...base, state: 'conflict', kind: 'barcode_mismatch', receiverProductId: null, candidates: [candidate] };
      }
      return { ...base, state: 'green', kind: 'auto', receiverProductId: candidate.id, candidates: [] };
    }
    if (matches.length > 1) {
      return { ...base, state: 'conflict', kind: 'ambiguous', receiverProductId: null, candidates: matches };
    }
    return { ...base, state: 'conflict', kind: 'only_in_sender', receiverProductId: null, candidates: [] };
  });

  return {
    rows,
    receiverProducts: receiverProducts
      .map(({ id, name, barcode }) => ({ id, name, barcode }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
};

export const createDrizzleProductSyncRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
): ProductSyncRepository & { copyOnCreate: SyncCopyRunner } => {
  const hydrate = async (executor: Executor, rows: Array<Omit<BranchLinkRecord, 'senderBranchName' | 'receiverBranchName'>>): Promise<BranchLinkRecord[]> => {
    const names = await branchNames(executor, [...new Set(rows.flatMap((row) => [row.senderBranchId, row.receiverBranchId]))]);
    return rows.map((row) => ({
      ...row,
      senderBranchName: names.get(row.senderBranchId) ?? '',
      receiverBranchName: names.get(row.receiverBranchId) ?? '',
    }));
  };

  const auditAnswer = async (
    tx: Tx,
    link: Pick<BranchLinkRecord, 'senderBranchId' | 'receiverBranchId'>,
    senderProductId: number,
    afterState: Record<string, unknown>,
    actingAccountId: number,
    at: Date,
  ) => {
    await audit.record(tx, {
      module: 'erp-product-sync', action: 'settle', entityType: 'product-link', entityId: senderProductId,
      afterState, relatedIds: { branchId: link.receiverBranchId, actingAccountId }, createdAt: at,
    });
  };

  /**
   * A's product as B's copy: name and description only, priced at zero and
   * waiting for its first stock. Runs in the caller's transaction (inside a
   * savepoint when called for a create) so a failure undoes only this receiver.
   */
  const copyOne = async (
    executor: SyncCopyExecutor,
    product: ProductCopyInput,
    receiverBranchId: number,
    actingAccountId: number,
  ) => {
    const at = now();
    // Lock by the key an identical name would have, so two copies of the same
    // name cannot both decide the receiving shelf is free.
    const matches = await executor.select({ id: erpProducts.id }).from(erpProducts).where(and(
      eq(erpProducts.branchId, receiverBranchId),
      eq(erpProducts.matchKey, product.matchKey),
    )).for('update').limit(2);
    if (matches.length) throw new ProductCopyIssue('name_clash');

    const created = await executor.insert(erpProducts).values({
      branchId: receiverBranchId,
      name: product.name,
      nameNormalized: normalizeCatalogName(product.name),
      matchKey: product.matchKey,
      description: product.description,
      sellingPrice: '0.00',
      lastPurchaseCost: '0.00',
      commissionPercent: '0.00',
      lowStockThreshold: 0,
      barcode: null,
      isActive: false,
      awaitingFirstStock: true,
      createdAt: at,
      updatedAt: at,
    });
    const copyId = Number(created[0].insertId);
    await executor.insert(erpProductStocks).values({
      productId: copyId, branchId: receiverBranchId, quantity: 0, updatedAt: at,
    });
    await executor.insert(erpProductLinks).values({
      senderBranchId: product.branchId,
      receiverBranchId,
      senderProductId: product.productId,
      receiverProductId: copyId,
      state: 'linked',
      notSameAsProductId: null,
      createdAt: at,
      updatedAt: at,
    });
    // Both branches get their own entry; B's says where the product came from.
    await audit.record(executor, {
      module: 'erp-stock', action: 'create', entityType: 'product', entityId: copyId,
      afterState: {
        id: copyId, branchId: receiverBranchId, name: product.name,
        isActive: false, awaitingFirstStock: true, sellingPrice: '0.00',
        syncSourceBranchId: product.branchId,
      },
      relatedIds: { branchId: receiverBranchId, actingAccountId, syncSourceBranchId: product.branchId },
      createdAt: at,
    });
  };

  const copyOnCreate: SyncCopyRunner = async (tx, product, actingAccountId) => {
    const links = await tx.select({ receiverBranchId: erpBranchLinks.receiverBranchId })
      .from(erpBranchLinks)
      .where(and(
        eq(erpBranchLinks.senderBranchId, product.branchId),
        eq(erpBranchLinks.state, 'active' as const),
      ))
      .orderBy(asc(erpBranchLinks.receiverBranchId));

    for (const link of links) {
      try {
        // One savepoint per receiver: a branch's failure undoes only that copy.
        await tx.transaction(async (savepoint) => {
          await copyOne(savepoint, product, link.receiverBranchId, actingAccountId);
        });
      } catch (error) {
        const at = now();
        const reason = copyReason(error);
        // A's product still commits; the gap is visible instead of silent.
        await tx.insert(erpProductSyncIssues).values({
          senderBranchId: product.branchId,
          receiverBranchId: link.receiverBranchId,
          senderProductId: product.productId,
          reason,
          createdAt: at,
          updatedAt: at,
        }).onDuplicateKeyUpdate({ set: { reason, updatedAt: at } });
      }
    }
  };

  const hydrateIssues = async (rows: Array<{
    id: number; senderBranchId: number; receiverBranchId: number;
    senderProductId: number; reason: 'name_clash' | 'copy_failed'; createdAt: Date;
  }>): Promise<SyncIssue[]> => {
    if (!rows.length) return [];
    const branchIds = [...new Set(rows.flatMap((row) => [row.senderBranchId, row.receiverBranchId]))];
    const names = await branchNames(database, branchIds);
    const products = await database.select({ id: erpProducts.id, name: erpProducts.name })
      .from(erpProducts).where(inArray(erpProducts.id, [...new Set(rows.map((row) => row.senderProductId))]));
    const productNames = new Map(products.map((product) => [product.id, product.name]));
    const links = await database.select({
      id: erpBranchLinks.id,
      senderBranchId: erpBranchLinks.senderBranchId,
      receiverBranchId: erpBranchLinks.receiverBranchId,
    }).from(erpBranchLinks).where(or(
      inArray(erpBranchLinks.senderBranchId, branchIds),
      inArray(erpBranchLinks.receiverBranchId, branchIds),
    ));
    const linkIds = new Map(links.map((link) => [`${link.senderBranchId}:${link.receiverBranchId}`, link.id]));
    return rows.map((row) => ({
      id: row.id,
      linkId: linkIds.get(`${row.senderBranchId}:${row.receiverBranchId}`) ?? null,
      senderBranchId: row.senderBranchId,
      senderBranchName: names.get(row.senderBranchId) ?? '',
      receiverBranchId: row.receiverBranchId,
      receiverBranchName: names.get(row.receiverBranchId) ?? '',
      senderProductId: row.senderProductId,
      productName: productNames.get(row.senderProductId) ?? '',
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  };

  const issueSelection = {
    id: erpProductSyncIssues.id,
    senderBranchId: erpProductSyncIssues.senderBranchId,
    receiverBranchId: erpProductSyncIssues.receiverBranchId,
    senderProductId: erpProductSyncIssues.senderProductId,
    reason: erpProductSyncIssues.reason,
    createdAt: erpProductSyncIssues.createdAt,
  };

  return {
    async listLinks() {
      const rows = await database.select(linkSelection).from(erpBranchLinks)
        .orderBy(asc(erpBranchLinks.senderBranchId), asc(erpBranchLinks.receiverBranchId));
      return hydrate(database, rows);
    },

    async findLink(id) {
      const rows = await database.select(linkSelection).from(erpBranchLinks).where(eq(erpBranchLinks.id, id)).limit(1);
      return (await hydrate(database, rows))[0] ?? null;
    },

    async createLink(input: CreateBranchLinkInput, actingAccountId) {
      return database.transaction(async (tx) => {
        if (input.senderBranchId === input.receiverBranchId) throw syncError('SYNC_SAME_BRANCH');
        // Both branch rows are locked in one order, so two Admins creating A ⇒ B
        // and B ⇒ A at the same moment take turns instead of both passing.
        const ids = [input.senderBranchId, input.receiverBranchId].sort((left, right) => left - right);
        const locked = await tx.select({ id: branches.id, name: branches.name }).from(branches)
          .where(inArray(branches.id, ids)).orderBy(asc(branches.id)).for('update');
        if (locked.length !== 2) throw syncError('SYNC_BRANCH_NOT_FOUND');

        const existing = await tx.select({
          senderBranchId: erpBranchLinks.senderBranchId,
          receiverBranchId: erpBranchLinks.receiverBranchId,
        }).from(erpBranchLinks).where(or(
          inArray(erpBranchLinks.senderBranchId, ids),
          inArray(erpBranchLinks.receiverBranchId, ids),
        ));
        // A branch is a sender, a receiver, or neither — never both.
        if (existing.some((row) => row.receiverBranchId === input.senderBranchId)) {
          throw syncError('SYNC_SENDER_IS_RECEIVER');
        }
        if (existing.some((row) => row.senderBranchId === input.receiverBranchId)) {
          throw syncError('SYNC_RECEIVER_IS_SENDER');
        }
        if (existing.some((row) => row.receiverBranchId === input.receiverBranchId)) {
          throw syncError('SYNC_RECEIVER_TAKEN');
        }

        const at = now();
        const inserted = await tx.insert(erpBranchLinks).values({
          senderBranchId: input.senderBranchId,
          receiverBranchId: input.receiverBranchId,
          state: 'pending',
          createdByAccountId: actingAccountId,
          createdAt: at,
          updatedAt: at,
        });
        const created = await tx.select(linkSelection).from(erpBranchLinks)
          .where(eq(erpBranchLinks.id, Number(inserted[0].insertId))).limit(1);
        const [record] = await hydrate(tx, created);
        await audit.record(tx, {
          module: 'erp-product-sync', action: 'create', entityType: 'branch-link', entityId: record!.id,
          afterState: record, relatedIds: { branchId: input.senderBranchId, actingAccountId }, createdAt: at,
        });
        return record!;
      });
    },

    async deleteLink(id) {
      await database.delete(erpBranchLinks).where(eq(erpBranchLinks.id, id));
    },

    async setup(link) {
      return computeSetup(database, link);
    },

    async settle(link, senderProductId, input: SettleProductLinkInput, actingAccountId) {
      await database.transaction(async (tx) => {
        const sender = (await tx.select({ id: erpProducts.id, name: erpProducts.name, description: erpProducts.description })
          .from(erpProducts)
          .where(and(eq(erpProducts.id, senderProductId), eq(erpProducts.branchId, link.senderBranchId)))
          .limit(1))[0];
        if (!sender) throw syncError('SYNC_PRODUCT_NOT_FOUND');
        const at = now();

        if (input.action === 'create') {
          const name = input.name.trim();
          const nameNormalized = normalizeCatalogName(name);
          const matchKey = matchKeyFor(name);
          // Free under both rules: the branch still enforces its own name rule,
          // and the cross-branch key decides what the next setup would match.
          const clash = (await tx.select({ id: erpProducts.id }).from(erpProducts).where(and(
            eq(erpProducts.branchId, link.receiverBranchId),
            or(eq(erpProducts.nameNormalized, nameNormalized), eq(erpProducts.matchKey, matchKey)),
          )).limit(1))[0];
          if (clash) throw syncError('SYNC_NAME_TAKEN');

          const created = await tx.insert(erpProducts).values({
            branchId: link.receiverBranchId,
            name,
            nameNormalized,
            matchKey,
            // Only these two come from A. B prices it at activation and owns
            // everything else.
            description: sender.description,
            sellingPrice: '0.00',
            lastPurchaseCost: '0.00',
            commissionPercent: '0.00',
            lowStockThreshold: 0,
            barcode: null,
            isActive: false,
            awaitingFirstStock: true,
            createdAt: at,
            updatedAt: at,
          });
          const receiverProductId = Number(created[0].insertId);
          await tx.insert(erpProductStocks).values({
            productId: receiverProductId, branchId: link.receiverBranchId, quantity: 0, updatedAt: at,
          });
          await upsertAnswer(tx, link, senderProductId, {
            receiverProductId, state: 'linked', notSameAsProductId: null, at,
          });
          await auditAnswer(tx, link, senderProductId, { action: 'create', receiverProductId, name }, actingAccountId, at);
          return;
        }

        if (input.action === 'link') {
          const receiver = (await tx.select({ id: erpProducts.id }).from(erpProducts).where(and(
            eq(erpProducts.id, input.receiverProductId),
            eq(erpProducts.branchId, link.receiverBranchId),
          )).limit(1))[0];
          if (!receiver) throw syncError('SYNC_PRODUCT_NOT_FOUND');
          const taken = (await tx.select({ id: erpProductLinks.id }).from(erpProductLinks).where(and(
            pairOf(link),
            eq(erpProductLinks.receiverProductId, receiver.id),
          )).limit(1))[0];
          if (taken) throw syncError('SYNC_RECEIVER_TAKEN_BY_OTHER');
          await upsertAnswer(tx, link, senderProductId, {
            receiverProductId: receiver.id, state: 'linked', notSameAsProductId: null, at,
          });
          await auditAnswer(tx, link, senderProductId, { action: 'link', receiverProductId: receiver.id }, actingAccountId, at);
          return;
        }

        if (input.notSameAsProductId !== null) {
          const compared = (await tx.select({ id: erpProducts.id }).from(erpProducts).where(and(
            eq(erpProducts.id, input.notSameAsProductId),
            eq(erpProducts.branchId, link.receiverBranchId),
          )).limit(1))[0];
          if (!compared) throw syncError('SYNC_PRODUCT_NOT_FOUND');
        }
        // A settled "don't copy": recorded so it is never asked again, and so a
        // transfer never lands on the product it was compared with.
        await upsertAnswer(tx, link, senderProductId, {
          receiverProductId: null, state: 'excluded', notSameAsProductId: input.notSameAsProductId, at,
        });
        await auditAnswer(tx, link, senderProductId, {
          action: 'exclude', notSameAsProductId: input.notSameAsProductId,
        }, actingAccountId, at);
      });
    },

    async activate(link, actingAccountId) {
      await database.transaction(async (tx) => {
        const current = (await tx.select(linkSelection).from(erpBranchLinks)
          .where(eq(erpBranchLinks.id, link.id)).for('update').limit(1))[0];
        if (!current) throw syncError('SYNC_LINK_NOT_FOUND');
        if (current.state === 'active') return;

        const rows = (await computeSetup(tx, link)).rows;
        if (rows.some((row) => row.state === 'conflict')) throw syncError('SYNC_SETUP_INCOMPLETE');

        const at = now();
        for (const row of rows) {
          if (row.kind !== 'auto' || row.receiverProductId === null) continue;
          try {
            await tx.insert(erpProductLinks).values({
              senderBranchId: link.senderBranchId,
              receiverBranchId: link.receiverBranchId,
              senderProductId: row.senderProductId,
              receiverProductId: row.receiverProductId,
              state: 'linked',
              notSameAsProductId: null,
              createdAt: at,
              updatedAt: at,
            });
          } catch (error) {
            // Another Admin settled this row while we were computing it; their
            // answer wins and ours is not needed.
            if (!isDuplicateEntry(error)) throw error;
          }
        }

        await tx.update(erpBranchLinks).set({ state: 'active', updatedAt: at })
          .where(eq(erpBranchLinks.id, link.id));
        await audit.record(tx, {
          module: 'erp-product-sync', action: 'activate', entityType: 'branch-link', entityId: link.id,
          beforeState: { state: 'pending' }, afterState: { state: 'active' },
          relatedIds: { branchId: link.senderBranchId, actingAccountId }, createdAt: at,
        });
      });
    },

    async excluded(link): Promise<SyncExcludedRow[]> {
      const rows = await database.select({
        senderProductId: erpProductLinks.senderProductId,
        notSameAsProductId: erpProductLinks.notSameAsProductId,
      }).from(erpProductLinks).where(and(
        pairOf(link),
        eq(erpProductLinks.state, 'excluded'),
      )).orderBy(asc(erpProductLinks.senderProductId));
      if (!rows.length) return [];
      const ids = [...new Set(rows.flatMap((row) => (
        row.notSameAsProductId === null ? [row.senderProductId] : [row.senderProductId, row.notSameAsProductId]
      )))];
      const products = await database.select({ id: erpProducts.id, name: erpProducts.name, barcode: erpProducts.barcode })
        .from(erpProducts).where(inArray(erpProducts.id, ids));
      const byId = new Map(products.map((product) => [product.id, product]));
      return rows.map((row) => {
        const sender = byId.get(row.senderProductId);
        const compared = row.notSameAsProductId === null ? undefined : byId.get(row.notSameAsProductId);
        return {
          senderProductId: row.senderProductId,
          name: sender?.name ?? '',
          notSameAs: compared ?? null,
        };
      });
    },

    async issues() {
      const rows = await database.select(issueSelection).from(erpProductSyncIssues)
        .where(isNull(erpProductSyncIssues.settledAt))
        .orderBy(asc(erpProductSyncIssues.createdAt), asc(erpProductSyncIssues.id));
      return hydrateIssues(rows);
    },

    async findIssue(id) {
      const rows = await database.select(issueSelection).from(erpProductSyncIssues)
        .where(and(eq(erpProductSyncIssues.id, id), isNull(erpProductSyncIssues.settledAt)))
        .limit(1);
      return (await hydrateIssues(rows))[0] ?? null;
    },

    async markIssueSettled(id, actingAccountId) {
      const at = now();
      await database.update(erpProductSyncIssues)
        .set({ settledByAccountId: actingAccountId, settledAt: at, updatedAt: at })
        .where(eq(erpProductSyncIssues.id, id));
    },

    async retryIssue(issue, actingAccountId) {
      await database.transaction(async (tx) => {
        const product = (await tx.select({
          id: erpProducts.id,
          branchId: erpProducts.branchId,
          name: erpProducts.name,
          description: erpProducts.description,
          matchKey: erpProducts.matchKey,
        }).from(erpProducts).where(eq(erpProducts.id, issue.senderProductId)).for('update').limit(1))[0];
        if (!product) throw syncError('SYNC_PRODUCT_NOT_FOUND');

        const at = now();
        try {
          await tx.transaction(async (savepoint) => {
            await copyOne(savepoint, {
              branchId: product.branchId,
              productId: product.id,
              name: product.name,
              description: product.description,
              matchKey: product.matchKey,
            }, issue.receiverBranchId, actingAccountId);
          });
          await tx.update(erpProductSyncIssues)
            .set({ settledByAccountId: actingAccountId, settledAt: at, updatedAt: at })
            .where(eq(erpProductSyncIssues.id, issue.id));
        } catch (error) {
          // Still blocked: the row stays, carrying the reason this attempt found.
          await tx.update(erpProductSyncIssues)
            .set({ reason: copyReason(error), updatedAt: at })
            .where(eq(erpProductSyncIssues.id, issue.id));
        }
      });
    },

    async linkedProductIds(branchId) {
      const sent = await database.select({ id: erpProductLinks.senderProductId })
        .from(erpProductLinks).where(eq(erpProductLinks.senderBranchId, branchId));
      const received = await database.select({ id: erpProductLinks.receiverProductId })
        .from(erpProductLinks).where(and(
          eq(erpProductLinks.receiverBranchId, branchId),
          isNotNull(erpProductLinks.receiverProductId),
        ));
      return [...new Set([
        ...sent.map((row) => row.id),
        ...received.flatMap((row) => (row.id === null ? [] : [row.id])),
      ])];
    },

    copyOnCreate,
  };
};

const upsertAnswer = async (
  tx: Tx,
  link: Pick<BranchLinkRecord, 'senderBranchId' | 'receiverBranchId'>,
  senderProductId: number,
  answer: {
    receiverProductId: number | null;
    state: 'linked' | 'excluded';
    notSameAsProductId: number | null;
    at: Date;
  },
) => {
  await tx.insert(erpProductLinks).values({
    senderBranchId: link.senderBranchId,
    receiverBranchId: link.receiverBranchId,
    senderProductId,
    receiverProductId: answer.receiverProductId,
    state: answer.state,
    notSameAsProductId: answer.notSameAsProductId,
    createdAt: answer.at,
    updatedAt: answer.at,
  }).onDuplicateKeyUpdate({
    set: {
      receiverProductId: answer.receiverProductId,
      state: answer.state,
      notSameAsProductId: answer.notSameAsProductId,
      updatedAt: answer.at,
    },
  });
};

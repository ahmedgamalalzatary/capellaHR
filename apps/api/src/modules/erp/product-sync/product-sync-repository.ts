import { type createDatabase } from '@capella/database';
import { branches, erpBranchLinks, erpProducts, erpProductLinks, erpProductStocks } from '@capella/database/schema';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { CreateBranchLinkInput, SettleProductLinkInput } from '@capella/contracts';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { matchKeyFor, normalizeCatalogName } from '../catalog/index.js';
import {
  syncError,
  type BranchLinkRecord,
  type ProductSyncRepository,
  type SyncCandidate,
  type SyncExcludedRow,
  type SyncSetupRow,
} from './product-sync-service.js';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

const isDuplicateEntry = (error: unknown) => typeof error === 'object' && error !== null && (
  Reflect.get(error, 'code') === 'ER_DUP_ENTRY'
  || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY'
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
): ProductSyncRepository => {
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

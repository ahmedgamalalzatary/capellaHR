import type { ConfirmBranchLinkInput, CreateBranchLinkInput, SettleProductLinkInput } from '@capella/contracts';

import type { ErpAccountIdentity } from '../hr-capabilities.js';

export type BranchLinkRecord = {
  id: number;
  senderBranchId: number;
  senderBranchName: string;
  receiverBranchId: number;
  receiverBranchName: string;
  state: 'pending' | 'active';
  createdAt: Date;
  updatedAt: Date;
};

export type SyncCandidate = { id: number; name: string; barcode: string | null };

/**
 * One of A's products and what the system would do with it in B. `green` means
 * nothing is left to answer, whether the system found the row or the Admin did.
 * The setup screen is computed live, so a product A created a moment ago is a
 * row here without anything having to be stored.
 */
export type SyncSetupRow = {
  senderProductId: number;
  name: string;
  description: string | null;
  barcode: string | null;
  state: 'green' | 'conflict';
  kind: 'auto' | 'linked' | 'excluded' | 'ambiguous' | 'barcode_mismatch' | 'only_in_sender' | 'receiver_taken';
  receiverProductId: number | null;
  candidates: SyncCandidate[];
};

export type SyncSetup = {
  link: BranchLinkRecord;
  rows: SyncSetupRow[];
  /** Every product B has, so a conflict can be settled against any of them. */
  receiverProducts: SyncCandidate[];
  allGreen: boolean;
};

export type SyncExcludedRow = {
  senderProductId: number;
  name: string;
  notSameAs: SyncCandidate | null;
};

/** A product A created that B could not take, waiting for the Admin. */
export type SyncIssue = {
  id: number;
  linkId: number | null;
  senderBranchId: number;
  senderBranchName: string;
  receiverBranchId: number;
  receiverBranchName: string;
  senderProductId: number;
  productName: string;
  reason: 'name_clash' | 'copy_failed';
  createdAt: Date;
};

export type SettleIssueInput = SettleProductLinkInput | { action: 'retry' };

export interface ProductSyncRepository {
  listLinks(): Promise<BranchLinkRecord[]>;
  findLink(id: number): Promise<BranchLinkRecord | null>;
  createLink(input: CreateBranchLinkInput, actingAccountId: number): Promise<BranchLinkRecord>;
  deleteLink(id: number): Promise<void>;
  setup(link: BranchLinkRecord): Promise<{ rows: SyncSetupRow[]; receiverProducts: SyncCandidate[] }>;
  settle(
    link: Pick<BranchLinkRecord, 'senderBranchId' | 'receiverBranchId'>,
    senderProductId: number,
    input: SettleProductLinkInput,
    actingAccountId: number,
  ): Promise<void>;
  activate(link: BranchLinkRecord, actingAccountId: number, decisions?: ConfirmBranchLinkInput['decisions']): Promise<void>;
  excluded(link: BranchLinkRecord): Promise<SyncExcludedRow[]>;
  issues(): Promise<SyncIssue[]>;
  findIssue(id: number): Promise<SyncIssue | null>;
  markIssueSettled(id: number, actingAccountId: number): Promise<void>;
  retryIssue(issue: SyncIssue, actingAccountId: number): Promise<void>;
  linkedProductIds(branchId: number): Promise<number[]>;
}

export type ProductSyncErrorCode =
  | 'SYNC_ADMIN_REQUIRED'
  | 'SYNC_LINK_NOT_FOUND'
  | 'SYNC_BRANCH_NOT_FOUND'
  | 'SYNC_SAME_BRANCH'
  | 'SYNC_SENDER_IS_RECEIVER'
  | 'SYNC_RECEIVER_IS_SENDER'
  | 'SYNC_RECEIVER_TAKEN'
  | 'SYNC_SETUP_INCOMPLETE'
  | 'SYNC_PRODUCT_NOT_FOUND'
  | 'SYNC_RECEIVER_TAKEN_BY_OTHER'
  | 'SYNC_NAME_TAKEN'
  | 'SYNC_ISSUE_NOT_FOUND';

export class ProductSyncError extends Error {
  constructor(public readonly code: ProductSyncErrorCode, message: string) {
    super(message);
    this.name = 'ProductSyncError';
  }
}

const messages: Record<ProductSyncErrorCode, string> = {
  SYNC_ADMIN_REQUIRED: 'مزامنة المنتجات بين الفروع متاحة للمسؤول فقط',
  SYNC_LINK_NOT_FOUND: 'رابط الفرعين غير موجود',
  SYNC_BRANCH_NOT_FOUND: 'الفرع غير موجود',
  SYNC_SAME_BRANCH: 'لا يمكن ربط فرع بنفسه',
  SYNC_SENDER_IS_RECEIVER: 'هذا الفرع يستقبل منتجات من فرع آخر، فلا يمكن أن يكون مرسلًا',
  SYNC_RECEIVER_IS_SENDER: 'هذا الفرع يرسل منتجات إلى فرع آخر، فلا يمكن أن يستقبل',
  SYNC_RECEIVER_TAKEN: 'هذا الفرع مرتبط بمصدر آخر بالفعل',
  SYNC_SETUP_INCOMPLETE: 'لا يمكن تفعيل الرابط قبل تسوية كل الصفوف',
  SYNC_PRODUCT_NOT_FOUND: 'المنتج غير موجود في هذا الفرع',
  SYNC_RECEIVER_TAKEN_BY_OTHER: 'هذا المنتج مرتبط بمنتج آخر من الفرع المرسل',
  SYNC_NAME_TAKEN: 'الاسم مستخدم في الفرع المستلم',
  SYNC_ISSUE_NOT_FOUND: 'عنصر المزامنة غير موجود',
};

export const syncError = (code: ProductSyncErrorCode) => new ProductSyncError(code, messages[code]);

const withSetup = (
  link: BranchLinkRecord,
  setup: { rows: SyncSetupRow[]; receiverProducts: SyncCandidate[] },
): SyncSetup => ({
  link,
  rows: setup.rows,
  receiverProducts: setup.receiverProducts,
  allGreen: setup.rows.every((row) => row.state === 'green'),
});

export const createProductSyncService = (dependencies: {
  repository: ProductSyncRepository;
}) => {
  const { repository } = dependencies;

  const requireAdmin = (actor: ErpAccountIdentity) => {
    // The route already refuses a Cashier; this keeps the rule true for every
    // caller, including the setup and activation paths.
    if (actor.role !== 'admin') throw syncError('SYNC_ADMIN_REQUIRED');
  };
  const requireLink = async (id: number) => {
    const link = await repository.findLink(id);
    if (!link) throw syncError('SYNC_LINK_NOT_FOUND');
    return link;
  };

  return {
    async list(actor: ErpAccountIdentity) {
      requireAdmin(actor);
      return repository.listLinks();
    },
    async create(actor: ErpAccountIdentity, input: CreateBranchLinkInput) {
      requireAdmin(actor);
      return repository.createLink(input, actor.accountId);
    },
    async setup(actor: ErpAccountIdentity, id: number): Promise<SyncSetup> {
      requireAdmin(actor);
      const link = await requireLink(id);
      return withSetup(link, await repository.setup(link));
    },
    async settle(actor: ErpAccountIdentity, id: number, senderProductId: number, input: SettleProductLinkInput) {
      requireAdmin(actor);
      const link = await requireLink(id);
      await repository.settle(link, senderProductId, input, actor.accountId);
      return withSetup(link, await repository.setup(link));
    },
    async activate(actor: ErpAccountIdentity, id: number, input: ConfirmBranchLinkInput = { decisions: [] }): Promise<SyncSetup> {
      requireAdmin(actor);
      const link = await requireLink(id);
      await repository.activate(link, actor.accountId, input.decisions);
      const updated = await requireLink(id);
      return withSetup(updated, await repository.setup(updated));
    },
    async excluded(actor: ErpAccountIdentity, id: number) {
      requireAdmin(actor);
      return repository.excluded(await requireLink(id));
    },
    /**
     * The "needs attention" list: products A created that B could not take.
     * They are never silently dropped — either the copy exists or one of these
     * rows does.
     */
    async issues(actor: ErpAccountIdentity) {
      requireAdmin(actor);
      return repository.issues();
    },
    async settleIssue(actor: ErpAccountIdentity, issueId: number, input: SettleIssueInput) {
      requireAdmin(actor);
      const issue = await repository.findIssue(issueId);
      if (!issue) throw syncError('SYNC_ISSUE_NOT_FOUND');
      if (input.action === 'retry') {
        await repository.retryIssue(issue, actor.accountId);
        return;
      }
      // The three answers are the same ones setup offers, so they write the same
      // product-link row; the issue is then closed.
      await repository.settle(
        { senderBranchId: issue.senderBranchId, receiverBranchId: issue.receiverBranchId },
        issue.senderProductId, input, actor.accountId,
      );
      await repository.markIssueSettled(issueId, actor.accountId);
    },
    /** Ids to badge in the products list: linked on either side of the link. */
    async linkedProducts(actor: ErpAccountIdentity, branchId: number) {
      requireAdmin(actor);
      return repository.linkedProductIds(branchId);
    },
    async remove(actor: ErpAccountIdentity, id: number) {
      requireAdmin(actor);
      await requireLink(id);
      // Product links outlive the branch link: transfers keep using them.
      await repository.deleteLink(id);
    },
  };
};

export type ProductSyncService = ReturnType<typeof createProductSyncService>;

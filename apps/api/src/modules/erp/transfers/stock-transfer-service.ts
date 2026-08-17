import type {
  CreateStockTransferInput,
  ListStockTransfersQuery,
} from '@capella/contracts';

import type { ErpAccountIdentity, ErpBranchCapability } from '../hr-capabilities.js';
import type { SaleTransaction } from '../sales/index.js';

export type StockTransferLineRecord = {
  sourceProductId: number;
  destinationProductId: number;
  productName: string;
  quantity: number;
  unitCost: string;
  lineTotal: string;
};

export type StockTransferRecord = {
  id: number;
  sourceBranchId: number;
  sourceBranchName: string;
  destinationBranchId: number;
  destinationBranchName: string;
  invoiceId: number;
  invoiceNumber: string;
  transferDate: string;
  totalCost: string;
  note: string | null;
  actingAccountId: number;
  createdAt: Date;
  lines: StockTransferLineRecord[];
};

export type TransferSourceProduct = {
  id: number;
  name: string;
  unitCost: string;
  quantity: number;
  isActive: boolean;
};

export type ApplyDestinationInput = {
  invoiceId: number;
  sourceBranchId: number;
  destinationBranchId: number;
  actingAccountId: number;
  idempotencyKey: string;
  transferDate: string;
  note: string | null;
  postedAt: Date;
  lines: Array<{ productId: number; productName: string; quantity: number; unitCost: string }>;
};

export interface StockTransferRepository {
  findByIdempotencyKey(key: string): Promise<StockTransferRecord | null>;
  readSourceProducts(branchId: number, productIds: number[]): Promise<TransferSourceProduct[]>;
  /** The receiving branch as a client of the sending branch, created once. */
  ensureTransferClient(
    sourceBranchId: number,
    destinationBranchName: string,
    now: Date,
  ): Promise<number>;
  findOpenSession(branchId: number): Promise<{ id: number } | null>;
  applyDestination(
    transaction: SaleTransaction,
    input: ApplyDestinationInput,
  ): Promise<StockTransferRecord>;
  list(
    query: ListStockTransfersQuery,
  ): Promise<{ items: StockTransferRecord[]; total: number }>;
}

export type StockTransferErrorCode =
  | 'TRANSFER_ADMIN_REQUIRED'
  | 'TRANSFER_BRANCH_NOT_FOUND'
  | 'TRANSFER_SHIFT_REQUIRED'
  | 'TRANSFER_COST_REQUIRED'
  | 'TRANSFER_COST_CHANGED'
  | 'TRANSFER_DESTINATION_PRODUCT_INACTIVE'
  | 'TRANSFER_KEY_REUSED'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK';

const messages: Record<StockTransferErrorCode, string> = {
  TRANSFER_ADMIN_REQUIRED: 'تحويل المنتجات بين الفروع متاح للمدير فقط',
  TRANSFER_BRANCH_NOT_FOUND: 'الفرع غير موجود',
  TRANSFER_SHIFT_REQUIRED: 'يجب وجود وردية مفتوحة في الفرع المُرسِل لتسجيل التحويل',
  TRANSFER_COST_REQUIRED: 'يجب تسجيل تكلفة شراء المنتج قبل تحويله',
  TRANSFER_COST_CHANGED: 'تغيرت تكلفة المنتج أثناء التحويل، أعد المحاولة',
  TRANSFER_DESTINATION_PRODUCT_INACTIVE: 'المنتج موقوف في الفرع المستلم، أعد تنشيطه أولاً',
  TRANSFER_KEY_REUSED: 'مفتاح العملية مستخدم لتحويل مختلف',
  PRODUCT_NOT_FOUND: 'المنتج غير موجود',
  INSUFFICIENT_STOCK: 'الكمية المتاحة غير كافية',
};

export class StockTransferError extends Error {
  constructor(public readonly code: StockTransferErrorCode) {
    super(messages[code]);
    this.name = 'StockTransferError';
  }
}

const toCents = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(2, '0').slice(0, 2)}`);
};
const fromCents = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

/**
 * The sale re-reads and locks what we checked a moment earlier, so its failures
 * are ordinary outcomes of a busy till, not server faults. Each maps onto the
 * transfer's own vocabulary so the admin gets a 409 and an Arabic reason.
 */
const saleFailures: Record<string, StockTransferErrorCode> = {
  PAYMENT_TOTAL_MISMATCH: 'TRANSFER_COST_CHANGED',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  PRODUCT_UNAVAILABLE: 'PRODUCT_NOT_FOUND',
  CASHIER_SESSION_NOT_OPEN: 'TRANSFER_SHIFT_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'TRANSFER_KEY_REUSED',
};

const saleFailure = (error: unknown): StockTransferErrorCode | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  if (Reflect.get(error, 'name') !== 'SaleError') return undefined;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? saleFailures[code] : undefined;
};

/**
 * A key identifies one transfer. Replaying it must return that transfer, so a
 * key reused for different goods or different branches is a mistake, not a
 * retry — the sale layer guards its own key the same way.
 */
const sameTransfer = (record: StockTransferRecord, input: CreateStockTransferInput) => (
  record.sourceBranchId === input.sourceBranchId
  && record.destinationBranchId === input.destinationBranchId
  && record.note === (input.note ?? null)
  && record.lines.length === input.lines.length
  // A product appears at most once per transfer, so matching each input line to
  // some stored line of the same length settles both sides.
  && input.lines.every((line) => record.lines.some((stored) => (
    stored.sourceProductId === line.productId && stored.quantity === line.quantity
  )))
);

/** What a transfer needs of the posted invoice: its id and its priced lines. */
type PostedInvoice = {
  id: number;
  lines: Array<{
    itemType: 'service' | 'product';
    sourceId: number;
    name: string;
    quantity: number;
    unitPrice: string;
  }>;
};

type SaleCompleter = {
  complete(
    actor: ErpAccountIdentity,
    input: unknown,
    options?: {
      pricing?: 'selling' | 'cost';
      kind?: 'sale' | 'branch_transfer';
      afterInvoice?(transaction: SaleTransaction, invoice: PostedInvoice): Promise<void>;
    },
  ): Promise<{ id: number }>;
};

export type StockTransferService = ReturnType<typeof createStockTransferService>;

/**
 * Moving products between branches is a sale from one to the other, priced at
 * cost so neither side books a profit on the move itself. The sending branch
 * therefore issues a real invoice, and the receiving branch gains the stock —
 * both inside the sale's own transaction, so a transfer is never half done.
 */
export const createStockTransferService = (dependencies: {
  repository: StockTransferRepository;
  sales: SaleCompleter;
  branches: ErpBranchCapability;
  now?: () => Date;
}) => {
  const { repository, sales, branches } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const cairoDate = (value: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);

  return {
    async transfer(
      actor: ErpAccountIdentity,
      input: CreateStockTransferInput,
    ): Promise<StockTransferRecord> {
      if (actor.role !== 'admin') throw new StockTransferError('TRANSFER_ADMIN_REQUIRED');

      const replay = await repository.findByIdempotencyKey(input.idempotencyKey);
      if (replay) {
        if (!sameTransfer(replay, input)) throw new StockTransferError('TRANSFER_KEY_REUSED');
        return replay;
      }

      const [source, destination] = await Promise.all([
        branches.findById(input.sourceBranchId),
        branches.findById(input.destinationBranchId),
      ]);
      if (!source || !destination) throw new StockTransferError('TRANSFER_BRANCH_NOT_FOUND');

      const products = await repository.readSourceProducts(
        source.id,
        input.lines.map(({ productId }) => productId),
      );
      const byId = new Map(products.map((product) => [product.id, product]));
      const lines = input.lines.map((line) => {
        const product = byId.get(line.productId);
        if (!product || !product.isActive) throw new StockTransferError('PRODUCT_NOT_FOUND');
        if (toCents(product.unitCost) <= 0n) throw new StockTransferError('TRANSFER_COST_REQUIRED');
        if (product.quantity < line.quantity) throw new StockTransferError('INSUFFICIENT_STOCK');
        return {
          productId: product.id,
          productName: product.name,
          quantity: line.quantity,
          unitCost: product.unitCost,
        };
      });
      const total = lines.reduce(
        (sum, line) => sum + toCents(line.unitCost) * BigInt(line.quantity),
        0n,
      );

      const at = now();
      const transferDate = cairoDate(at);
      const session = await repository.findOpenSession(source.id);
      if (!session) throw new StockTransferError('TRANSFER_SHIFT_REQUIRED');
      const clientId = await repository.ensureTransferClient(source.id, destination.name, at);

      let posted: StockTransferRecord | undefined;
      try {
        await sales.complete(actor, {
          branchId: source.id,
          clientId,
          cashierSessionId: session.id,
          idempotencyKey: input.idempotencyKey,
          lines: lines.map((line) => ({
            itemType: 'product' as const,
            productId: line.productId,
            quantity: line.quantity,
          })),
          payments: [{ method: 'cash' as const, amount: fromCents(total) }],
        }, {
          pricing: 'cost',
          kind: 'branch_transfer',
          afterInvoice: async (transaction, invoice) => {
            posted = await repository.applyDestination(transaction, {
              invoiceId: invoice.id,
              sourceBranchId: source.id,
              destinationBranchId: destination.id,
              actingAccountId: actor.accountId,
              idempotencyKey: input.idempotencyKey,
              transferDate,
              note: input.note ?? null,
              postedAt: at,
              // The costs we quoted a moment ago may have moved; the invoice
              // holds what the sale actually locked and charged, so the
              // receiving branch records those and not our stale reading.
              lines: invoice.lines
                .filter((line) => line.itemType === 'product')
                .map((line) => ({
                  productId: line.sourceId,
                  productName: line.name,
                  quantity: line.quantity,
                  unitCost: line.unitPrice,
                })),
            });
          },
        });
      } catch (error) {
        const failure = saleFailure(error);
        if (failure) throw new StockTransferError(failure);
        throw error;
      }

      // A replayed sale returns the stored invoice without re-running our work.
      return posted ?? (await repository.findByIdempotencyKey(input.idempotencyKey))!;
    },

    async list(actor: ErpAccountIdentity, query: ListStockTransfersQuery) {
      if (actor.role !== 'admin') throw new StockTransferError('TRANSFER_ADMIN_REQUIRED');
      return repository.list(query);
    },
  };
};

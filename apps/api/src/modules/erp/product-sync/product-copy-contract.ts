import type { createDatabase } from '@capella/database';

/** The transaction a product create already runs in. */
export type SyncCopyExecutor = Parameters<Parameters<ReturnType<typeof createDatabase>['transaction']>[0]>[0];

export type ProductCopyInput = {
  /** The branch that created the product, and the product itself. */
  branchId: number;
  productId: number;
  name: string;
  description: string | null;
  matchKey: string;
};

/**
 * Copies a freshly created product to every active receiver. It runs inside the
 * caller's transaction and never throws for a receiver's failure: a copy that
 * cannot be made is recorded as a "needs attention" row instead, so A's product
 * still commits.
 */
export type SyncCopyRunner = (
  executor: SyncCopyExecutor,
  input: ProductCopyInput,
  actingAccountId: number,
) => Promise<void>;

import type {
  CreateFixedAssetInput,
  FixedAssetCondition,
  ListFixedAssetsQuery,
  UpdateFixedAssetInput,
} from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

/**
 * The branch's own furniture and machines, written down so the admin can look
 * them up. Nothing else in the system reads this register, which is why a line
 * is edited and deleted in place instead of being corrected by a reversal the
 * way money records are.
 */
export type FixedAssetRecord = {
  id: number;
  branchId: number;
  name: string;
  quantity: number | null;
  unitPrice: string | null;
  location: string;
  note: string;
  purchasedOn: string | null;
  condition: FixedAssetCondition | null;
  actingAccountId: number;
  actingUsername: string;
  createdAt: Date;
  updatedAt: Date;
};
export type FixedAssetWrite = Omit<CreateFixedAssetInput, 'branchId'> & {
  branchId: number;
  actingAccountId: number;
};

export interface FixedAssetRepository {
  create(input: FixedAssetWrite): Promise<FixedAssetRecord>;
  findById(id: number): Promise<FixedAssetRecord | null>;
  list(branchId: number, query: ListFixedAssetsQuery): Promise<{ items: FixedAssetRecord[]; total: number }>;
  update(id: number, input: FixedAssetWrite): Promise<FixedAssetRecord | null>;
  remove(id: number, scope: { branchId: number; actingAccountId: number }): Promise<boolean>;
}

export type FixedAssetErrorCode = 'FIXED_ASSET_NOT_FOUND';
const messages: Record<FixedAssetErrorCode, string> = {
  FIXED_ASSET_NOT_FOUND: 'العنصر غير موجود',
};
export class FixedAssetError extends Error {
  constructor(public readonly code: FixedAssetErrorCode) {
    super(messages[code]);
    this.name = 'FixedAssetError';
  }
}
const fail = (code: FixedAssetErrorCode): never => { throw new FixedAssetError(code); };

export const createFixedAssetService = ({ repository, resolveBranchContext }: {
  repository: FixedAssetRepository;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const context = (actor: ErpAccountIdentity, branchId?: number) => resolveBranchContext(actor, branchId);
  /** A line of another branch is not merely refused; it is not disclosed at all. */
  const ownedLine = async (actor: ErpAccountIdentity, id: number, branchId?: number) => {
    const scope = await context(actor, branchId);
    const record = await repository.findById(id);
    if (!record || record.branchId !== scope.branchId) return fail('FIXED_ASSET_NOT_FOUND');
    return scope;
  };

  return {
    async create(actor: ErpAccountIdentity, input: CreateFixedAssetInput): Promise<FixedAssetRecord> {
      const scope = await context(actor, input.branchId);
      return repository.create({ ...input, branchId: scope.branchId, actingAccountId: scope.accountId });
    },
    async get(actor: ErpAccountIdentity, id: number, branchId?: number): Promise<FixedAssetRecord> {
      const scope = await context(actor, branchId);
      const record = await repository.findById(id);
      if (!record || record.branchId !== scope.branchId) return fail('FIXED_ASSET_NOT_FOUND');
      return record;
    },
    async list(actor: ErpAccountIdentity, query: ListFixedAssetsQuery) {
      const scope = await context(actor, query.branchId);
      return repository.list(scope.branchId, query);
    },
    async update(actor: ErpAccountIdentity, id: number, input: UpdateFixedAssetInput): Promise<FixedAssetRecord> {
      const scope = await ownedLine(actor, id, input.branchId);
      const updated = await repository.update(id, {
        ...input, branchId: scope.branchId, actingAccountId: scope.accountId,
      });
      // Lost the race with another admin's delete between the read and the write.
      if (!updated) return fail('FIXED_ASSET_NOT_FOUND');
      return updated;
    },
    async remove(actor: ErpAccountIdentity, id: number, branchId?: number): Promise<void> {
      const scope = await ownedLine(actor, id, branchId);
      const removed = await repository.remove(id, { branchId: scope.branchId, actingAccountId: scope.accountId });
      if (!removed) fail('FIXED_ASSET_NOT_FOUND');
    },
  };
};
export type FixedAssetService = ReturnType<typeof createFixedAssetService>;

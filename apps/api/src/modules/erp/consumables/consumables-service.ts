import type {
  CompleteServiceExecutionsInput,
  ConfigureConsumableInput,
  CorrectServiceExecutionInput,
  ListConsumableBalancesQuery,
  ListConsumableServicesQuery,
  TransferConsumableStockInput,
} from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

export type ConsumablesErrorCode =
  | 'CONSUMABLES_ADMIN_REQUIRED'
  | 'CONSUMABLE_PRODUCT_NOT_FOUND'
  | 'CONSUMABLE_NOT_CONFIGURED'
  | 'CONSUMABLE_BALANCE_NOT_ZERO'
  | 'CONSUMABLE_INSUFFICIENT_SELLABLE_STOCK'
  | 'CONSUMABLE_INSUFFICIENT_BALANCE'
  | 'CONSUMABLE_UNIT_MISMATCH'
  | 'CONSUMABLE_SERVICE_NOT_FOUND'
  | 'CONSUMABLE_SERVICE_ALREADY_COMPLETED'
  | 'CONSUMABLE_SERVICE_NOT_COMPLETED'
  | 'CONSUMABLE_SERVICE_CANCELLED'
  | 'CONSUMABLE_DUPLICATE_USAGE'
  | 'CONSUMABLE_SERVICES_MUST_MATCH'
  | 'CONSUMABLE_SHIFT_CLOSED';

export class ConsumablesError extends Error {
  constructor(public readonly code: ConsumablesErrorCode, message: string) {
    super(message);
    this.name = 'ConsumablesError';
  }
}

export interface ConsumablesRepository {
  configure(productId: number, branchId: number, unit: 'ml' | 'gm', packageSize: string, accountId: number): Promise<unknown>;
  transfer(input: { productId: number; branchId: number; direction: 'reserve' | 'return'; packages: number; note?: string; accountId: number }): Promise<unknown>;
  listBalances(branchId: number, query: ListConsumableBalancesQuery): Promise<{ items: unknown[]; total: number }>;
  listServices(branchId: number, query: ListConsumableServicesQuery, openedByAccountId?: number): Promise<{ items: unknown[]; total: number }>;
  complete(input: { branchId: number; accountId: number; accountRole: 'admin' | 'cashier'; serviceQueueEntryIds: number[]; usages: Array<{ productId: number; quantity: string }> }): Promise<unknown>;
  correct(input: { branchId: number; accountId: number; accountRole: 'admin' | 'cashier'; serviceQueueEntryId: number; reason: string; usages: Array<{ productId: number; quantity: string }> }): Promise<unknown>;
}

export const createConsumablesService = (dependencies: {
  repository: ConsumablesRepository;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const adminContext = async (actor: ErpAccountIdentity, branchId?: number) => {
    if (actor.role !== 'admin') {
      throw new ConsumablesError('CONSUMABLES_ADMIN_REQUIRED', 'إدارة مخزون المستهلكات متاحة للمسؤول فقط');
    }
    return dependencies.resolveBranchContext(actor, branchId);
  };

  return {
    async configure(actor: ErpAccountIdentity, productId: number, input: ConfigureConsumableInput) {
      const context = await adminContext(actor, input.branchId);
      return dependencies.repository.configure(productId, context.branchId, input.unit, input.packageSize, context.accountId);
    },
    async transfer(actor: ErpAccountIdentity, productId: number, input: TransferConsumableStockInput) {
      const context = await adminContext(actor, input.branchId);
      return dependencies.repository.transfer({
        productId, branchId: context.branchId, direction: input.direction,
        packages: input.packages, ...(input.note ? { note: input.note } : {}), accountId: context.accountId,
      });
    },
    async listBalances(actor: ErpAccountIdentity, query: ListConsumableBalancesQuery) {
      const context = await dependencies.resolveBranchContext(actor, query.branchId);
      return dependencies.repository.listBalances(context.branchId, query);
    },
    async listServices(actor: ErpAccountIdentity, query: ListConsumableServicesQuery) {
      const context = await dependencies.resolveBranchContext(actor, query.branchId);
      return dependencies.repository.listServices(
        context.branchId,
        query,
        context.accountRole === 'cashier' ? context.accountId : undefined,
      );
    },
    async complete(actor: ErpAccountIdentity, input: CompleteServiceExecutionsInput) {
      const context = await dependencies.resolveBranchContext(actor, input.branchId);
      return dependencies.repository.complete({
        branchId: context.branchId, accountId: context.accountId, accountRole: context.accountRole,
        serviceQueueEntryIds: input.serviceQueueEntryIds, usages: input.usages,
      });
    },
    async correct(actor: ErpAccountIdentity, serviceQueueEntryId: number, input: CorrectServiceExecutionInput) {
      const context = await dependencies.resolveBranchContext(actor, input.branchId);
      return dependencies.repository.correct({
        branchId: context.branchId, accountId: context.accountId, accountRole: context.accountRole,
        serviceQueueEntryId, reason: input.reason, usages: input.usages,
      });
    },
  };
};

export type ConsumablesService = ReturnType<typeof createConsumablesService>;

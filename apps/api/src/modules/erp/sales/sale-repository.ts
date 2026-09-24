import { type createDatabase } from '@capella/database';
import type { ErpAuditCapability, ErpPayrollCapability } from '../hr-capabilities.js';
import { quoteSale } from './sale-repository-read.js';
import { createSaleRepositoryQueries } from './sale-repository-queries.js';
import { createSaleRepositoryReassignments } from './sale-repository-reassignment.js';
import { createSaleRepositorySupport } from './sale-repository-support.js';
import { createSaleRepositoryComplete } from './sale-repository-complete.js';
import { createSaleRepositoryPayments } from './sale-repository-payment.js';
import { createSaleRepositoryReversals } from './sale-repository-reverse.js';
import type { SaleRepository } from './sale-service.js';

type Database = ReturnType<typeof createDatabase>;

export const createDrizzleSaleRepository = (
  database: Database,
  audit: ErpAuditCapability,
  payroll?: ErpPayrollCapability,
): SaleRepository => {
  const { projectCommission, listInvoiceEmployees, findByIdempotencyKey, existingReversal, existingReassignment } =
    createSaleRepositorySupport(database, payroll);
  const repository: SaleRepository = {
    quote: (branchId, input) => quoteSale(database, branchId, input),

    findByIdempotencyKey,

    ...createSaleRepositoryComplete(database, audit, payroll, { projectCommission, findByIdempotencyKey }),

    ...createSaleRepositoryPayments(database, audit),

    ...createSaleRepositoryReassignments(database, audit, payroll,
      { projectCommission, existingReassignment }),

    ...createSaleRepositoryReversals(database, audit, payroll, { projectCommission, existingReversal }),

    ...createSaleRepositoryQueries(database, listInvoiceEmployees),

  };
  return repository;
};

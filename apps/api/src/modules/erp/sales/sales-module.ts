import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { EmployeeAssignmentService } from '../assignment/assignment-service.js';
import type {
  ErpAuditCapability,
  ErpBranchCapability,
  ErpEmployeeCapability,
  ErpPayrollCapability,
} from '../hr-capabilities.js';
import { createDrizzleCashierSessionRepository } from './cashier-sessions-repository.js';
import { createCashierSessionService } from './cashier-sessions-service.js';
import { createDrizzleInvoiceSequenceStore } from './invoice-sequence-store.js';
import { createDrizzleSaleRepository } from './sale-repository.js';
import { createSaleService } from './sale-service.js';
import { createInvoiceNumberAllocator } from './services/invoice-number.js';

export const createSalesModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: {
    audit: ErpAuditCapability;
    branches: ErpBranchCapability;
    employees: ErpEmployeeCapability;
    assignment: EmployeeAssignmentService;
    payroll?: ErpPayrollCapability;
  },
) => {
  const cashierSessionRepository = createDrizzleCashierSessionRepository(
    database,
    capabilities.audit,
  );
  const cashierSessions = createCashierSessionService({
    repository: cashierSessionRepository,
    resolveBranchContext: createErpBranchContextResolver(capabilities),
  });
  const saleRepository = createDrizzleSaleRepository(
    database,
    capabilities.audit,
    capabilities.payroll,
  );
  const sales = createSaleService({
    repository: saleRepository,
    resolveBranchContext: createErpBranchContextResolver(capabilities),
    assignment: capabilities.assignment,
    invoiceNumbers: createInvoiceNumberAllocator(createDrizzleInvoiceSequenceStore(database)),
  });
  return { cashierSessionRepository, cashierSessions, saleRepository, sales };
};

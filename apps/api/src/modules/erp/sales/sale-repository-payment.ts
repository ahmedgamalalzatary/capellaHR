import { type createDatabase } from '@capella/database';
import {
  cashierSessions,
  invoiceLines,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { ErpAuditCapability } from '../hr-capabilities.js';
import { CASHIER_SESSION_MAX_DURATION_MS } from './cashier-sessions-service.js';
import { hydrateInvoice } from './sale-repository-read.js';
import { SaleError, type RecordInvoicePaymentOperation, type SaleRepository } from './sale-service.js';
import { toCents } from './services/sale-calculations.js';

type Database = ReturnType<typeof createDatabase>;

export const createSaleRepositoryPayments = (
  database: Database,
  audit: ErpAuditCapability,
): Pick<SaleRepository, 'recordPayment'> => ({
    async recordPayment(operation: RecordInvoicePaymentOperation) {
      return database.transaction(async (transaction) => {
        const original = (await transaction.select().from(invoices).where(and(
          eq(invoices.id, operation.invoiceId),
          eq(invoices.branchId, operation.input.branchId),
        )).for('update').limit(1))[0];
        if (!original || original.status === 'draft') throw new SaleError('INVOICE_NOT_FOUND');

        const existing = (await transaction.select().from(invoicePayments).where(and(
          eq(invoicePayments.invoiceId, original.id),
          eq(invoicePayments.operationReference, operation.input.operationReference),
        )).limit(1))[0];
        if (existing) {
          if (existing.method !== operation.input.method || existing.amount !== operation.input.amount) {
            throw new SaleError('IDEMPOTENCY_CONFLICT');
          }
          const replayed = await hydrateInvoice(transaction, original.id);
          if (!replayed) throw new SaleError('INVOICE_NOT_FOUND');
          return replayed;
        }
        if (!['completed', 'partially_refunded'].includes(original.status)) {
          throw new SaleError('INVOICE_NOT_REVERSIBLE');
        }
        const hasService = (await transaction.select({ id: invoiceLines.id }).from(invoiceLines)
          .where(and(eq(invoiceLines.invoiceId, original.id), eq(invoiceLines.itemType, 'service')))
          .limit(1))[0];
        if (hasService) throw new SaleError('PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES');
        if (toCents(operation.input.amount) > toCents(original.balanceDue!)) {
          throw new SaleError('PAYMENT_EXCEEDS_BALANCE');
        }
        const session = (await transaction.select().from(cashierSessions).where(and(
          eq(cashierSessions.id, operation.input.cashierSessionId),
          eq(cashierSessions.branchId, operation.input.branchId),
          isNull(cashierSessions.closedAt),
          gt(cashierSessions.openedAt,
            new Date(operation.paidAt.getTime() - CASHIER_SESSION_MAX_DURATION_MS)),
        )).for('update').limit(1))[0];
        if (!session || (operation.actingAccountRole === 'cashier'
          && session.openedByAccountId !== operation.actingAccountId)) {
          throw new SaleError('CASHIER_SESSION_NOT_OPEN');
        }
        const beforeState = await hydrateInvoice(transaction, original.id);
        await transaction.insert(invoicePayments).values({
          invoiceId: original.id,
          method: operation.input.method,
          amount: operation.input.amount,
          operationReference: operation.input.operationReference,
          isInitial: false,
          cashierSessionId: session.id,
          actingAccountId: operation.actingAccountId,
          paidAt: operation.paidAt,
          createdAt: operation.paidAt,
        });
        const afterState = await hydrateInvoice(transaction, original.id);
        if (!afterState) throw new SaleError('INVOICE_NOT_FOUND');
        await audit.record(transaction, {
          module: 'erp-sales', action: 'record_payment', entityType: 'invoice',
          entityId: original.id, beforeState, afterState,
          relatedIds: { branchId: original.branchId, cashierSessionId: session.id },
          createdAt: operation.paidAt,
        });
        return afterState;
      });
    }

});


import { type createDatabase } from '@capella/database';
import {
  accounts, cashierSessions, commissionLedgerEntries, invoiceLines, invoiceLineReassignments,
  invoiceReversalLines, invoiceReversals, invoices, serviceQueueEntries, serviceQueueReassignments,
} from '@capella/database/schema';
import { and, desc, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';

import type { ErpAuditCapability, ErpPayrollCapability } from '../hr-capabilities.js';
import { cairoMonth } from '../cairo-calendar.js';
import { CASHIER_SESSION_MAX_DURATION_MS } from './cashier-sessions-service.js';
import { hydrateInvoice } from './sale-repository-read.js';
import { commissionCents, isDuplicateEntryError, signedMoney } from './sale-repository-money.js';
import type { createSaleRepositorySupport } from './sale-repository-support.js';
import { SaleError, type ReassignInvoiceLineOperation, type ReassignQueueOperation, type SaleRepository } from './sale-service.js';
import { toCents } from './services/sale-calculations.js';

type Database = ReturnType<typeof createDatabase>;
type Support = Pick<ReturnType<typeof createSaleRepositorySupport>,
  'projectCommission' | 'existingReassignment'>;

export const createSaleRepositoryReassignments = (
  database: Database,
  audit: ErpAuditCapability,
  payroll: ErpPayrollCapability | undefined,
  { projectCommission, existingReassignment }: Support,
): Pick<SaleRepository, 'reassignLine' | 'reassignQueue'> => ({    async reassignLine(operation: ReassignInvoiceLineOperation) {
      const existing = await existingReassignment(operation);
      if (existing) return existing;
      try {
        return await database.transaction(async (transaction) => {
          const invoice = (await transaction.select().from(invoices).where(and(
            eq(invoices.id, operation.invoiceId),
            eq(invoices.branchId, operation.input.branchId),
          )).for('update').limit(1))[0];
          if (!invoice) throw new SaleError('INVOICE_NOT_FOUND');
          if (invoice.status !== 'completed' && invoice.status !== 'partially_refunded') {
            throw new SaleError('INVOICE_NOT_REASSIGNABLE');
          }
          const committedRetry = await existingReassignment(operation, transaction);
          if (committedRetry) return committedRetry;
          const line = (await transaction.select().from(invoiceLines).where(and(
            eq(invoiceLines.id, operation.invoiceLineId),
            eq(invoiceLines.invoiceId, operation.invoiceId),
            eq(invoiceLines.branchId, operation.input.branchId),
          )).for('update').limit(1))[0];
          if (!line) throw new SaleError('INVOICE_NOT_FOUND');
          if (line.itemType !== 'service' || line.employeeId === null
            || line.commissionRuleSnapshot === 'none') {
            throw new SaleError('REASSIGN_LINE_NOT_SERVICE');
          }
          const prior = (await transaction.select().from(invoiceLineReassignments).where(
            eq(invoiceLineReassignments.invoiceLineId, line.id),
          ).orderBy(desc(invoiceLineReassignments.createdAt), desc(invoiceLineReassignments.id))
            .limit(1))[0];
          const fromEmployeeId = prior?.toEmployeeId ?? line.employeeId;
          if (fromEmployeeId === operation.input.employeeId) {
            throw new SaleError('REASSIGN_SAME_EMPLOYEE');
          }
          const target = await operation.assertEmployee(transaction);
          const employeeIds = [fromEmployeeId, target.id].sort((left, right) => left - right);
          if (payroll) {
            for (const employeeId of employeeIds) {
              await payroll.lockCommissionEmployee(employeeId, transaction);
            }
          }
          const ledger = await transaction.select().from(commissionLedgerEntries).where(
            eq(commissionLedgerEntries.invoiceLineId, line.id),
          );
          const commissionSource = prior
            ? ledger.find((entry) => entry.invoiceLineReassignmentId === prior.id
              && entry.entryType === 'reassignment_in')
            : ledger.find((entry) => entry.entryType === 'earned');
          if (!commissionSource) throw new Error('Commission source entry is missing');
          const finalizedReversalIds = new Set((await transaction.select({ id: invoiceReversals.id })
            .from(invoiceReversals).where(and(
              eq(invoiceReversals.invoiceId, invoice.id),
              eq(invoiceReversals.status, 'finalized'),
            ))).map(({ id }) => id));
          const commissionReversals = ledger.filter((entry) => (
            entry.reversesEntryId === commissionSource.id
            && entry.invoiceReversalId !== null
            && finalizedReversalIds.has(entry.invoiceReversalId)
          ));
          const remainingBase = toCents(commissionSource.baseAmount)
            - commissionReversals.reduce((sum, entry) => sum + toCents(entry.baseAmount), 0n);
          const remainingCommission = toCents(commissionSource.amount)
            + commissionReversals.reduce((sum, entry) => sum + toCents(entry.amount), 0n);
          if (remainingBase <= 0n || remainingCommission <= 0n) {
            throw new SaleError('INVOICE_NOT_REASSIGNABLE');
          }
          const inserted = await transaction.insert(invoiceLineReassignments).values({
            invoiceId: invoice.id,
            invoiceLineId: line.id,
            branchId: invoice.branchId,
            fromEmployeeId,
            toEmployeeId: target.id,
            reason: operation.input.reason,
            operationReference: operation.input.operationReference,
            actingAccountId: operation.actingAccountId,
            createdAt: operation.reassignedAt,
          });
          const reassignmentId = Number(inserted[0].insertId);
          const ledgerBase = {
            invoiceId: invoice.id,
            invoiceLineId: line.id,
            actingAccountId: operation.actingAccountId,
            invoiceLineReassignmentId: reassignmentId,
            commissionRuleSnapshot: line.commissionRuleSnapshot,
            commissionRateSnapshot: line.commissionRateSnapshot,
            baseAmount: signedMoney(remainingBase),
            createdAt: operation.reassignedAt,
          };
          await transaction.insert(commissionLedgerEntries).values({
            ...ledgerBase,
            employeeId: fromEmployeeId,
            entryType: 'reassignment_out' as const,
            amount: signedMoney(-remainingCommission),
          });
          await transaction.insert(commissionLedgerEntries).values({
            ...ledgerBase,
            employeeId: target.id,
            entryType: 'reassignment_in' as const,
            amount: signedMoney(remainingCommission),
          });
          for (const employeeId of employeeIds) {
            const result = await projectCommission(
              transaction, employeeId, cairoMonth(invoice.soldAt),
            );
            if (result === 'payroll_finalized'
              || result === 'payroll_finalized_without_commission') {
              throw new SaleError('REASSIGN_PAYROLL_FINALIZED');
            }
          }
          const afterState = await hydrateInvoice(transaction, invoice.id);
          if (!afterState) throw new SaleError('INVOICE_NOT_FOUND');
          await audit.record(transaction, {
            module: 'erp-sales', action: 'reassign_employee',
            entityType: 'invoice_line', entityId: line.id,
            afterState,
            relatedIds: {
              invoiceId: invoice.id, branchId: invoice.branchId,
              fromEmployeeId, toEmployeeId: target.id,
            },
            createdAt: operation.reassignedAt,
          });
          return afterState;
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const replay = await existingReassignment(operation);
        if (!replay) throw new SaleError('IDEMPOTENCY_CONFLICT');
        return replay;
      }
    },

    async reassignQueue(operation: ReassignQueueOperation) {
      const previous = (await database.select().from(serviceQueueReassignments).where(
        eq(serviceQueueReassignments.operationReference, operation.input.operationReference),
      ).limit(1))[0];
      if (previous) {
        const priorTicket = (await database.select({ invoiceId: serviceQueueEntries.invoiceId })
          .from(serviceQueueEntries).where(eq(serviceQueueEntries.id, previous.serviceQueueEntryId))
          .limit(1))[0];
        if (previous.serviceQueueEntryId !== operation.serviceQueueEntryId
          || previous.toEmployeeId !== operation.input.employeeId
          || previous.branchId !== operation.input.branchId
          || previous.actingAccountId !== operation.actingAccountId
          || previous.reason !== operation.input.reason
          || priorTicket?.invoiceId !== operation.invoiceId) {
          throw new SaleError('IDEMPOTENCY_CONFLICT');
        }
        const replay = await hydrateInvoice(database, operation.invoiceId);
        if (!replay) throw new SaleError('INVOICE_NOT_FOUND');
        return replay;
      }
      return database.transaction(async (transaction) => {
        const invoice = (await transaction.select().from(invoices).where(and(
          eq(invoices.id, operation.invoiceId), eq(invoices.branchId, operation.input.branchId),
        )).for('update').limit(1))[0];
        if (!invoice || !['completed', 'partially_refunded'].includes(invoice.status)) {
          throw new SaleError('INVOICE_NOT_REASSIGNABLE');
        }
        const committedRetry = (await transaction.select().from(serviceQueueReassignments).where(
          eq(serviceQueueReassignments.operationReference, operation.input.operationReference),
        ).limit(1))[0];
        if (committedRetry) {
          const priorTicket = (await transaction.select({ invoiceId: serviceQueueEntries.invoiceId })
            .from(serviceQueueEntries)
            .where(eq(serviceQueueEntries.id, committedRetry.serviceQueueEntryId)).limit(1))[0];
          if (committedRetry.serviceQueueEntryId !== operation.serviceQueueEntryId
            || committedRetry.toEmployeeId !== operation.input.employeeId
            || committedRetry.branchId !== operation.input.branchId
            || committedRetry.actingAccountId !== operation.actingAccountId
            || committedRetry.reason !== operation.input.reason
            || priorTicket?.invoiceId !== operation.invoiceId) {
            throw new SaleError('IDEMPOTENCY_CONFLICT');
          }
          const replay = await hydrateInvoice(transaction, invoice.id);
          if (!replay) throw new SaleError('INVOICE_NOT_FOUND');
          return replay;
        }
        const ticket = (await transaction.select().from(serviceQueueEntries).where(and(
          eq(serviceQueueEntries.id, operation.serviceQueueEntryId),
          eq(serviceQueueEntries.invoiceId, invoice.id),
          eq(serviceQueueEntries.branchId, operation.input.branchId),
        )).for('update').limit(1))[0];
        if (!ticket || ticket.status === 'canceled') throw new SaleError('INVOICE_NOT_REASSIGNABLE');
        const priorRefunds = await transaction.select({ quantity: invoiceReversalLines.quantity })
          .from(invoiceReversalLines).innerJoin(invoiceReversals,
            eq(invoiceReversals.id, invoiceReversalLines.reversalId))
          .where(and(eq(invoiceReversalLines.invoiceLineId, ticket.invoiceLineId),
            eq(invoiceReversals.status, 'finalized')));
        const mappedRefunds = await transaction.select({ id: commissionLedgerEntries.serviceQueueEntryId })
          .from(commissionLedgerEntries).innerJoin(invoiceReversals,
            eq(invoiceReversals.id, commissionLedgerEntries.invoiceReversalId))
          .where(and(eq(commissionLedgerEntries.invoiceLineId, ticket.invoiceLineId),
            eq(commissionLedgerEntries.entryType, 'reversal'),
            isNotNull(commissionLedgerEntries.serviceQueueEntryId),
            eq(invoiceReversals.status, 'finalized')));
        const mappedIds = new Set(mappedRefunds.map((entry) => entry.id));
        const legacyRefunded = priorRefunds.reduce((sum, refund) => sum + refund.quantity, 0)
          - mappedIds.size;
        const legacyIds = (await transaction.select({ id: serviceQueueEntries.id })
          .from(serviceQueueEntries)
          .where(eq(serviceQueueEntries.invoiceLineId, ticket.invoiceLineId))
          .orderBy(desc(serviceQueueEntries.queueNumber)))
          .filter((entry) => !mappedIds.has(entry.id))
          .slice(0, legacyRefunded);
        if (mappedIds.has(ticket.id) || legacyIds.some((entry) => entry.id === ticket.id)) {
          throw new SaleError('INVOICE_NOT_REASSIGNABLE');
        }
        if (ticket.status === 'completed' && operation.actingAccountRole !== 'admin') {
          throw new SaleError('REASSIGN_ADMIN_REQUIRED');
        }
        const account = (await transaction.select().from(accounts).where(
          eq(accounts.id, operation.actingAccountId),
        ).limit(1))[0];
        if (!account || !account.active || account.role !== operation.actingAccountRole) {
          throw new SaleError('INVOICE_NOT_REASSIGNABLE');
        }
        if (operation.actingAccountRole === 'cashier') {
          const session = (await transaction.select().from(cashierSessions).where(and(
            eq(cashierSessions.branchId, ticket.branchId),
            eq(cashierSessions.openedByAccountId, operation.actingAccountId),
            isNull(cashierSessions.closedAt),
            lte(cashierSessions.openedAt, operation.reassignedAt),
            gt(cashierSessions.openedAt,
              new Date(operation.reassignedAt.getTime() - CASHIER_SESSION_MAX_DURATION_MS)),
          )).limit(1))[0];
          if (!session) throw new SaleError('INVOICE_NOT_REASSIGNABLE');
        }
        const line = (await transaction.select().from(invoiceLines).where(
          eq(invoiceLines.id, ticket.invoiceLineId),
        ).limit(1))[0];
        if (!line || line.itemType !== 'service' || line.commissionRuleSnapshot === 'none') {
          throw new SaleError('REASSIGN_LINE_NOT_SERVICE');
        }
        if (ticket.employeeId === operation.input.employeeId) {
          throw new SaleError('REASSIGN_SAME_EMPLOYEE');
        }
        const target = await operation.assertEmployee(transaction);
        const employeeIds = [ticket.employeeId, target.id].sort((a, b) => a - b);
        if (payroll) {
          for (const employeeId of employeeIds) await payroll.lockCommissionEmployee(employeeId, transaction);
        }
        const ledger = await transaction.select().from(commissionLedgerEntries).where(
          eq(commissionLedgerEntries.invoiceLineId, line.id),
        );
        const recent = [...ledger].reverse().find((entry) => entry.serviceQueueEntryId === ticket.id
          && entry.entryType === 'reassignment_in');
        const legacy = [...ledger].reverse().find((entry) => entry.entryType === 'reassignment_in'
          && entry.invoiceLineReassignmentId !== null);
        const source = recent ?? legacy ?? ledger.find((entry) => entry.entryType === 'earned');
        if (!source) throw new Error('Commission source entry is missing');
        const unitBase = toCents(line.unitPrice);
        const unitNumber = BigInt(ticket.queueNumber - Math.min(...(await transaction.select({ number: serviceQueueEntries.queueNumber })
          .from(serviceQueueEntries).where(eq(serviceQueueEntries.invoiceLineId, line.id)))
          .map((entry) => entry.number)));
        const rate = line.commissionRateSnapshot;
        const unitAmount = commissionCents(unitBase * (unitNumber + 1n), rate)
          - commissionCents(unitBase * unitNumber, rate);
        if (unitAmount < 0n) throw new SaleError('INVOICE_NOT_REASSIGNABLE');
        const inserted = await transaction.insert(serviceQueueReassignments).values({
          serviceQueueEntryId: ticket.id, branchId: ticket.branchId,
          fromEmployeeId: ticket.employeeId, toEmployeeId: target.id,
          reason: operation.input.reason,
          operationReference: operation.input.operationReference,
          actingAccountId: operation.actingAccountId, createdAt: operation.reassignedAt,
        });
        const reassignmentId = Number(inserted[0].insertId);
        const common = {
          invoiceId: invoice.id, invoiceLineId: line.id,
          serviceQueueEntryId: ticket.id, serviceQueueReassignmentId: reassignmentId,
          actingAccountId: operation.actingAccountId,
          commissionRuleSnapshot: source.commissionRuleSnapshot,
          commissionRateSnapshot: source.commissionRateSnapshot,
          baseAmount: signedMoney(unitBase), createdAt: operation.reassignedAt,
        };
        await transaction.insert(commissionLedgerEntries).values([
          { ...common, employeeId: ticket.employeeId, entryType: 'reassignment_out', amount: signedMoney(-unitAmount) },
          { ...common, employeeId: target.id, entryType: 'reassignment_in', amount: signedMoney(unitAmount) },
        ]);
        await transaction.update(serviceQueueEntries).set({ employeeId: target.id }).where(
          eq(serviceQueueEntries.id, ticket.id),
        );
        for (const employeeId of employeeIds) {
          const result = await projectCommission(transaction, employeeId, cairoMonth(invoice.soldAt));
          if (result === 'payroll_finalized' || result === 'payroll_finalized_without_commission') {
            throw new SaleError('REASSIGN_PAYROLL_FINALIZED');
          }
        }
        const afterState = await hydrateInvoice(transaction, invoice.id);
        if (!afterState) throw new SaleError('INVOICE_NOT_FOUND');
        await audit.record(transaction, {
          module: 'erp-sales', action: 'reassign_employee',
          entityType: 'service_queue_entry', entityId: ticket.id,
          afterState, relatedIds: {
            invoiceId: invoice.id, branchId: invoice.branchId,
            fromEmployeeId: ticket.employeeId, toEmployeeId: target.id,
          }, createdAt: operation.reassignedAt,
        });
        return afterState;
      });
    },

});
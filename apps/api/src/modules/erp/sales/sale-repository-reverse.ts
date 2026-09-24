import { type createDatabase } from '@capella/database';
import {
  accounts,
  cashierSessions,
  commissionLedgerEntries,
  erpProductStocks,
  erpStockMovements,
  invoiceLines,
  invoiceLineReassignments,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
  serviceConsumptionReports,
  serviceQueueEntries,
  serviceQueueReassignments,
} from '@capella/database/schema';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
} from 'drizzle-orm';
import type { ErpAuditCapability, ErpPayrollCapability } from '../hr-capabilities.js';
import { cairoMonth } from '../cairo-calendar.js';
import { CASHIER_SESSION_MAX_DURATION_MS } from './cashier-sessions-service.js';
import { SaleError, type ReverseInvoiceOperation, type SaleRepository } from './sale-service.js';
import {
  allocateReversalAmounts,
  MoneyCalculationError,
  sumMoney,
  toCents,
} from './services/sale-calculations.js';
import { hydrateInvoice } from './sale-repository-read.js';
import { commissionCents, isDuplicateEntryError, signedMoney } from './sale-repository-money.js';
import type { createSaleRepositorySupport } from './sale-repository-support.js';

type Database = ReturnType<typeof createDatabase>;
type Support = Pick<ReturnType<typeof createSaleRepositorySupport>,
  'projectCommission' | 'existingReversal'>;
const cairoDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const createSaleRepositoryReversals = (
  database: Database,
  audit: ErpAuditCapability,
  payroll: ErpPayrollCapability | undefined,
  { projectCommission, existingReversal }: Support,
): Pick<SaleRepository, 'reverse'> => ({
    async reverse(operation: ReverseInvoiceOperation) {
      const existing = await existingReversal(operation);
      if (existing) return existing;
      // Read outside the transaction: a completed invoice's lines never change,
      // and a read inside would either freeze this transaction's snapshot before
      // the payroll lock or add line locks that deadlock concurrent reversals.
      const invoiceEmployeeIds = [...new Set((await database
        .select({ employeeId: invoiceLines.employeeId }).from(invoiceLines)
        .where(and(
          eq(invoiceLines.invoiceId, operation.invoiceId),
          eq(invoiceLines.branchId, operation.input.branchId),
          isNotNull(invoiceLines.employeeId),
        ))).map(({ employeeId }) => employeeId!))];
      const reassignedEmployeeIds = (await database.select({
        employeeId: invoiceLineReassignments.toEmployeeId,
      }).from(invoiceLineReassignments).where(
        eq(invoiceLineReassignments.invoiceId, operation.invoiceId),
      )).map(({ employeeId }) => employeeId);
      const queueReassignedEmployeeIds = (await database.select({
        employeeId: serviceQueueReassignments.toEmployeeId,
      }).from(serviceQueueReassignments).innerJoin(serviceQueueEntries,
        eq(serviceQueueEntries.id, serviceQueueReassignments.serviceQueueEntryId))
        .where(eq(serviceQueueEntries.invoiceId, operation.invoiceId)))
        .map(({ employeeId }) => employeeId);
      const commissionEmployeeIds = [...new Set([
        ...invoiceEmployeeIds, ...reassignedEmployeeIds, ...queueReassignedEmployeeIds,
      ])].sort((left, right) => left - right);
      try {
        return await database.transaction(async (transaction) => {
          const original = (await transaction.select().from(invoices).where(and(
            eq(invoices.id, operation.invoiceId),
            eq(invoices.branchId, operation.input.branchId),
            ne(invoices.status, 'draft'),
          )).for('update').limit(1))[0];
          if (!original) throw new SaleError('INVOICE_NOT_FOUND');
          // Reversing internal trade would return the stock to the sending
          // branch while the receiving branch keeps it: stock from nothing.
          if (original.kind !== 'sale') throw new SaleError('TRANSFER_NOT_REVERSIBLE');
          if (payroll) {
            for (const employeeId of commissionEmployeeIds) {
              await payroll.lockCommissionEmployee(employeeId, transaction);
            }
          }
          const replay = await existingReversal(operation, transaction);
          if (replay) return replay;
          if (original.status === 'refunded' || original.status === 'voided'
            || (operation.type === 'void' && original.status !== 'completed')) {
            throw new SaleError('INVOICE_NOT_REVERSIBLE');
          }
          if (operation.type === 'void'
            && cairoDate(original.soldAt) !== cairoDate(operation.reversedAt)) {
            throw new SaleError('VOID_DATE_EXPIRED');
          }
          if (operation.type === 'void' && original.settlementStatus === 'open'
            && original.amountPaid !== '0.00') {
            throw new SaleError('INVOICE_NOT_VOIDABLE_WHEN_PARTIALLY_PAID');
          }

          const account = (await transaction.select({
            role: accounts.role, branchId: accounts.branchId, active: accounts.active,
          }).from(accounts).where(eq(accounts.id, operation.actingAccountId))
            .for('update').limit(1))[0];
          if (!account || !account.active || account.role !== operation.actingAccountRole) {
            throw new SaleError('INVOICE_NOT_REVERSIBLE');
          }
          if (operation.actingAccountRole === 'cashier'
            && account.branchId !== operation.input.branchId) {
            throw new SaleError('INVOICE_NOT_REVERSIBLE');
          }

          const originalLines = await transaction.select().from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, original.id)).orderBy(asc(invoiceLines.lineNumber));
          const priorLines = await transaction.select({
            invoiceLineId: invoiceReversalLines.invoiceLineId,
            quantity: invoiceReversalLines.quantity,
          }).from(invoiceReversalLines).innerJoin(
            invoiceReversals,
            eq(invoiceReversals.id, invoiceReversalLines.reversalId),
          ).where(and(
            eq(invoiceReversalLines.invoiceId, original.id),
            eq(invoiceReversals.status, 'finalized'),
          ));
          const refundedByLine = new Map<number, number>();
          for (const line of priorLines) {
            refundedByLine.set(
              line.invoiceLineId,
              (refundedByLine.get(line.invoiceLineId) ?? 0) + line.quantity,
            );
          }
          const selected = operation.type === 'void'
            ? originalLines.map((line) => ({ invoiceLineId: line.id, quantity: line.quantity }))
            : operation.input.lines;
          let allocation;
          try {
            allocation = allocateReversalAmounts({
              lines: originalLines.map((line) => ({
                invoiceLineId: line.id, quantity: line.quantity, unitPrice: line.unitPrice,
                refundedQuantity: refundedByLine.get(line.id) ?? 0,
              })),
              selected,
              discountAmount: original.discountAmount,
              taxAmount: original.taxAmount,
            });
          } catch (error) {
            if (error instanceof MoneyCalculationError) {
              throw new SaleError('REFUND_QUANTITY_EXCEEDED');
            }
            throw error;
          }

          const originalPayments = await transaction.select().from(invoicePayments)
            .where(eq(invoicePayments.invoiceId, original.id)).orderBy(asc(invoicePayments.id));
          const priorPayments = await transaction.select({
            invoicePaymentId: invoiceReversalPayments.invoicePaymentId,
            cashAmount: invoiceReversalPayments.cashAmount,
          }).from(invoiceReversalPayments).innerJoin(
            invoiceReversals,
            eq(invoiceReversals.id, invoiceReversalPayments.reversalId),
          ).where(and(
            eq(invoiceReversals.invoiceId, original.id),
            eq(invoiceReversals.status, 'finalized'),
          ));
          const reversedByPayment = new Map<number, bigint>();
          for (const payment of priorPayments) {
            if (payment.invoicePaymentId === null) continue;
            reversedByPayment.set(
              payment.invoicePaymentId,
              (reversedByPayment.get(payment.invoicePaymentId) ?? 0n) + toCents(payment.cashAmount),
            );
          }
          const voidPaymentByMethod = new Map<typeof originalPayments[number]['method'], bigint>();
          for (const payment of originalPayments) {
            voidPaymentByMethod.set(
              payment.method,
              (voidPaymentByMethod.get(payment.method) ?? 0n) + toCents(payment.amount),
            );
          }
          const requestedPayments = operation.type === 'void'
            ? [...voidPaymentByMethod].map(([method, amount]) => ({ method, amount: signedMoney(amount) }))
            : operation.input.payments;
          const cashPayoutCents = toCents(allocation.total) > toCents(original.balanceDue!)
            ? toCents(allocation.total) - toCents(original.balanceDue!)
            : 0n;
          if (sumMoney(requestedPayments.map(({ amount }) => amount))
            !== signedMoney(cashPayoutCents)) {
            throw new SaleError('REFUND_PAYMENT_MISMATCH');
          }
          const debtCreditCents = toCents(allocation.total) - cashPayoutCents;
          const allocatedPayments = requestedPayments.length
            ? requestedPayments.map((payment, index) => ({
              ...payment,
              cashAmount: payment.amount,
              amount: index === 0
                ? signedMoney(toCents(payment.amount) + debtCreditCents)
                : payment.amount,
            }))
            : [{ method: 'cash' as const, amount: allocation.total, cashAmount: '0.00' }];
          // How the money physically goes back is the cashier's call, so any method
          // is accepted and only the total is checked. A refund is still linked to
          // the payment it reverses whenever it matches one and fits inside what is
          // left on it, which keeps the per-payment refundable accounting exact.
          const paymentRows = allocatedPayments.flatMap((requested) => {
            let remainingCash = toCents(requested.cashAmount);
            const rows: Array<{ invoicePaymentId: number | null; method: typeof requested.method; amount: string; cashAmount: string }> = [];
            for (const payment of originalPayments.filter(({ method }) => method === requested.method)) {
              const remaining = toCents(payment.amount) - (reversedByPayment.get(payment.id) ?? 0n);
              const linkedCents = remainingCash < remaining ? remainingCash : remaining;
              if (linkedCents <= 0n) continue;
              reversedByPayment.set(payment.id, (reversedByPayment.get(payment.id) ?? 0n) + linkedCents);
              rows.push({ invoicePaymentId: payment.id, method: requested.method, amount: signedMoney(linkedCents), cashAmount: signedMoney(linkedCents) });
              remainingCash -= linkedCents;
              if (remainingCash === 0n) break;
            }
            const linkedCash = toCents(requested.cashAmount) - remainingCash;
            const remainderAmount = toCents(requested.amount) - linkedCash;
            if (remainderAmount > 0n || rows.length === 0) {
              rows.push({
                invoicePaymentId: null,
                method: requested.method,
                amount: signedMoney(remainderAmount),
                cashAmount: signedMoney(remainingCash),
              });
            }
            return rows;
          });

          const beforeState = await hydrateInvoice(transaction, original.id);
          // The money goes back out of whichever till is open now, which is not the
          // till that sold the invoice. An admin may refund with no till open at
          // all, and a shift past its sixteen hours is spent whether or not the
          // sweep has written its close, so both cases leave this null.
          const payingSession = (await transaction.select({ id: cashierSessions.id })
            .from(cashierSessions).where(and(
              eq(cashierSessions.branchId, original.branchId),
              isNull(cashierSessions.closedAt),
              gt(
                cashierSessions.openedAt,
                new Date(operation.reversedAt.getTime() - CASHIER_SESSION_MAX_DURATION_MS),
              ),
            )).limit(1))[0];

          const inserted = await transaction.insert(invoiceReversals).values({
            invoiceId: original.id,
            branchId: original.branchId,
            cashierSessionId: payingSession?.id ?? null,
            type: operation.type,
            idempotencyKey: operation.input.idempotencyKey,
            reason: operation.input.reason,
            actingAccountId: operation.actingAccountId,
            approvingAccountId: null,
            grossAmount: allocation.grossAmount,
            discountAmount: allocation.discountAmount,
            taxAmount: allocation.taxAmount,
            total: allocation.total,
            businessDate: cairoDate(operation.reversedAt),
            createdAt: operation.reversedAt,
          });
          const reversalId = Number(inserted[0].insertId);
          await transaction.insert(invoiceReversalLines).values(allocation.lines.map((line) => ({
            reversalId,
            invoiceId: original.id,
            invoiceLineId: line.invoiceLineId,
            branchId: original.branchId,
            quantity: line.quantity,
            grossAmount: line.grossAmount,
            discountAmount: line.discountAmount,
            taxAmount: line.taxAmount,
            total: line.total,
          })));
          if (paymentRows.length) {
            const reversalPaymentValues = paymentRows
              .filter((payment) => toCents(payment.amount) > 0n)
              .map((payment) => ({
              reversalId,
              invoiceId: operation.invoiceId,
                invoicePaymentId: payment.invoicePaymentId,
                methodSnapshot: payment.method,
                amount: payment.amount,
                cashAmount: payment.cashAmount,
              }));
            if (reversalPaymentValues.length) {
              await transaction.insert(invoiceReversalPayments).values(reversalPaymentValues);
            }
          }

          const selectedByLine = new Map(selected.map((line) => [line.invoiceLineId, line.quantity]));
          const refundedTicketsByLine = new Map<number, typeof serviceQueueEntries.$inferSelect[]>();
          const previousTicketReversals = await transaction.select({
            invoiceLineId: commissionLedgerEntries.invoiceLineId,
            queueEntryId: commissionLedgerEntries.serviceQueueEntryId,
          }).from(commissionLedgerEntries).where(and(
            eq(commissionLedgerEntries.invoiceId, original.id),
            eq(commissionLedgerEntries.entryType, 'reversal'),
            isNotNull(commissionLedgerEntries.serviceQueueEntryId),
          ));
          for (const line of originalLines.filter((candidate) => (
            candidate.itemType === 'service' && selectedByLine.has(candidate.id)
          ))) {
            const tickets = await transaction.select().from(serviceQueueEntries)
              .where(eq(serviceQueueEntries.invoiceLineId, line.id))
              .orderBy(desc(serviceQueueEntries.queueNumber)).for('update');
            const mappedIds = new Set(previousTicketReversals.filter((entry) => (
              entry.invoiceLineId === line.id
            )).map((entry) => entry.queueEntryId));
            const legacyQuantity = (refundedByLine.get(line.id) ?? 0) - mappedIds.size;
            const eligible = tickets.filter((ticket) => !mappedIds.has(ticket.id));
            const unrefunded = eligible.slice(legacyQuantity);
            const unrefundedIds = unrefunded.map((ticket) => ticket.id);
            const reports = unrefundedIds.length ? await transaction.select({
              queueEntryId: serviceConsumptionReports.serviceQueueEntryId,
            }).from(serviceConsumptionReports).where(and(
              inArray(serviceConsumptionReports.serviceQueueEntryId, unrefundedIds),
              eq(serviceConsumptionReports.isCurrent, true),
            )) : [];
            const reported = new Set(reports.map((report) => report.queueEntryId));
            const unconsumed = (ticket: typeof unrefunded[number]) => ticket.status !== 'canceled'
              && (ticket.status !== 'completed' || !reported.has(ticket.id));
            const selectedTickets = [...unrefunded].sort((left, right) => (
              Number(unconsumed(right)) - Number(unconsumed(left))
              || right.queueNumber - left.queueNumber
            )).slice(0, selectedByLine.get(line.id));
            if (selectedTickets.length !== selectedByLine.get(line.id)) {
              throw new SaleError('REFUND_QUANTITY_EXCEEDED');
            }
            refundedTicketsByLine.set(line.id, selectedTickets);
            const queueIds = selectedTickets.filter(unconsumed).map((ticket) => ticket.id);
            if (queueIds.length) {
              await transaction.update(serviceQueueEntries).set({
                status: 'canceled', completedAt: null, completedByAccountId: null,
              })
                .where(inArray(serviceQueueEntries.id, queueIds));
            }
          }
          const productLines = originalLines.filter((line) => (
            line.itemType === 'product' && selectedByLine.has(line.id)
          )).sort((left, right) => left.productId! - right.productId!);
          if (productLines.length) {
            const productIds = [...new Set(productLines.map((line) => line.productId!))];
            const stocks = await transaction.select().from(erpProductStocks).where(and(
              eq(erpProductStocks.branchId, original.branchId),
              inArray(erpProductStocks.productId, productIds),
            )).orderBy(asc(erpProductStocks.productId)).for('update');
            const balanceByProduct = new Map(stocks.map((stock) => [stock.productId, stock.quantity]));
            for (const line of productLines) {
              const quantity = selectedByLine.get(line.id)!;
              const balanceBefore = balanceByProduct.get(line.productId!);
              if (balanceBefore === undefined) throw new SaleError('PRODUCT_UNAVAILABLE');
              const balanceAfter = balanceBefore + quantity;
              balanceByProduct.set(line.productId!, balanceAfter);
              await transaction.update(erpProductStocks).set({
                quantity: balanceAfter, updatedAt: operation.reversedAt,
              }).where(and(
                eq(erpProductStocks.productId, line.productId!),
                eq(erpProductStocks.branchId, original.branchId),
              ));
              await transaction.insert(erpStockMovements).values({
                productId: line.productId!, branchId: original.branchId,
                reason: operation.type, sourceType: operation.type, sourceId: reversalId,
                quantityDelta: quantity, balanceAfter,
                actingAccountId: operation.actingAccountId, createdAt: operation.reversedAt,
              });
            }
          }

          const ledger = await transaction.select().from(commissionLedgerEntries)
            .where(eq(commissionLedgerEntries.invoiceId, original.id));
          const assignmentHistory = await transaction.select().from(invoiceLineReassignments)
            .where(eq(invoiceLineReassignments.invoiceId, original.id))
            .orderBy(desc(invoiceLineReassignments.createdAt), desc(invoiceLineReassignments.id));
          const finalizedReversalIds = new Set((await transaction.select({ id: invoiceReversals.id })
            .from(invoiceReversals).where(and(
              eq(invoiceReversals.invoiceId, original.id),
              eq(invoiceReversals.status, 'finalized'),
            ))).map(({ id }) => id));
          // Reversed commission is owed back per employee: each commissioned
          // line takes it from whoever earned it.
          const reversedByEmployee = new Map<number, bigint>();
          for (const line of originalLines.filter((candidate) => (
            candidate.commissionRuleSnapshot !== 'none' && selectedByLine.has(candidate.id)
          ))) {
            if (line.itemType === 'service') {
              const tickets = await transaction.select().from(serviceQueueEntries)
                .where(eq(serviceQueueEntries.invoiceLineId, line.id))
                .orderBy(asc(serviceQueueEntries.queueNumber));
              const selectedTickets = refundedTicketsByLine.get(line.id) ?? [];
              const lineLedger = ledger.filter((entry) => entry.invoiceLineId === line.id);
              const legacyAssignment = assignmentHistory.find((entry) => entry.invoiceLineId === line.id);
              const legacySource = legacyAssignment
                ? lineLedger.find((entry) => entry.invoiceLineReassignmentId === legacyAssignment.id
                  && entry.entryType === 'reassignment_in')
                : lineLedger.find((entry) => entry.entryType === 'earned');
              if (!legacySource) throw new Error('Commission source entry is missing');
              for (const ticket of selectedTickets) {
                const index = tickets.findIndex((candidate) => candidate.id === ticket.id);
                const source = lineLedger.filter((entry) => (
                  entry.serviceQueueEntryId === ticket.id && entry.entryType === 'reassignment_in'
                )).sort((left, right) => right.id - left.id)[0] ?? legacySource;
                const base = toCents(line.unitPrice);
                const amount = commissionCents(base * BigInt(index + 1), source.commissionRateSnapshot)
                  - commissionCents(base * BigInt(index), source.commissionRateSnapshot);
                reversedByEmployee.set(source.employeeId,
                  (reversedByEmployee.get(source.employeeId) ?? 0n) + amount);
                await transaction.insert(commissionLedgerEntries).values({
                  invoiceId: original.id, invoiceLineId: line.id,
                  serviceQueueEntryId: ticket.id, employeeId: source.employeeId,
                  actingAccountId: operation.actingAccountId, entryType: 'reversal',
                  reversesEntryId: source.id, invoiceReversalId: reversalId,
                  commissionRuleSnapshot: source.commissionRuleSnapshot,
                  commissionRateSnapshot: source.commissionRateSnapshot,
                  baseAmount: signedMoney(base), amount: signedMoney(-amount),
                  createdAt: operation.reversedAt,
                });
              }
              continue;
            }
            const earned = ledger.find((entry) => (
              entry.invoiceLineId === line.id && entry.entryType === 'earned'
            ))!;
            const priorBase = ledger.filter((entry) => (
              entry.reversesEntryId === earned.id
              && entry.invoiceReversalId !== null
              && finalizedReversalIds.has(entry.invoiceReversalId)
            ))
              .reduce((sum, entry) => sum + toCents(entry.baseAmount), 0n);
            const base = toCents(line.unitPrice) * BigInt(selectedByLine.get(line.id)!);
            const amount = commissionCents(priorBase + base, earned.commissionRateSnapshot)
              - commissionCents(priorBase, earned.commissionRateSnapshot);
            const lineEmployeeId = earned.employeeId;
            reversedByEmployee.set(
              lineEmployeeId,
              (reversedByEmployee.get(lineEmployeeId) ?? 0n) + amount,
            );
            await transaction.insert(commissionLedgerEntries).values({
              invoiceId: original.id,
              invoiceLineId: line.id,
              employeeId: lineEmployeeId,
              actingAccountId: operation.actingAccountId,
              entryType: 'reversal',
              reversesEntryId: earned.id,
              invoiceReversalId: reversalId,
              commissionRuleSnapshot: earned.commissionRuleSnapshot,
              commissionRateSnapshot: earned.commissionRateSnapshot,
              baseAmount: signedMoney(base),
              amount: signedMoney(-amount),
              createdAt: operation.reversedAt,
            });
          }

          await transaction.update(invoiceReversals).set({ status: 'finalized' })
            .where(eq(invoiceReversals.id, reversalId));

          if (payroll) {
            const month = cairoMonth(original.soldAt);
            for (const employeeId of [...reversedByEmployee.keys()]
              .sort((left, right) => left - right)) {
              const reversedCommission = reversedByEmployee.get(employeeId)!;
              if (reversedCommission <= 0n) continue;
              const projection = await projectCommission(transaction, employeeId, month);
              if (projection === 'payroll_finalized') {
                await payroll.recordPostPayrollDeduction({
                  employeeId,
                  occurredAt: operation.reversedAt,
                  amount: signedMoney(reversedCommission),
                  reference: `erp-commission-reversal:${reversalId}:${employeeId}`,
                }, transaction);
              }
            }
          }

          const afterState = await hydrateInvoice(transaction, original.id);
          if (!beforeState || !afterState) throw new Error('Reversed invoice could not be reloaded');
          await audit.record(transaction, {
            module: 'erp-sales', action: operation.type, entityType: 'invoice',
            entityId: original.id, beforeState, afterState,
            relatedIds: {
              branchId: original.branchId,
              reversalId,
              actingAccountId: operation.actingAccountId,
            },
            createdAt: operation.reversedAt,
          });
          return afterState;
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const existingAfterRace = await existingReversal(operation);
        if (!existingAfterRace) throw new SaleError('IDEMPOTENCY_CONFLICT');
        return existingAfterRace;
      }
    }

});


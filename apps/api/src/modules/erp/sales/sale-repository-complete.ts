import { type createDatabase } from '@capella/database';
import {
  accounts,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  erpBookings,
  erpProductStocks,
  erpStockMovements,
  erpServiceCommissionOverrides,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoices,
  serviceQueueEntries,
} from '@capella/database/schema';
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ErpAuditCapability, ErpPayrollCapability } from '../hr-capabilities.js';
import { cairoMonth } from '../cairo-calendar.js';
import { CASHIER_SESSION_MAX_DURATION_MS } from './cashier-sessions-service.js';
import { SaleError, type CompleteSaleOperation, type SaleRepository } from './sale-service.js';
import {
  calculateCommission,
  calculateSaleTotals,
  MoneyCalculationError,
  toCents,
} from './services/sale-calculations.js';
import {
  hydrateInvoice,
  keyedQueues,
  quoteProducts,
  quoteServices,
  reconstructInput,
} from './sale-repository-read.js';
import { isDuplicateEntryError, signedMoney } from './sale-repository-money.js';
import type { createSaleRepositorySupport } from './sale-repository-support.js';

import { ensureLegacyBatch, takeBatchQuantities } from '../stock/index.js';
import {
  readBookingCreditContext,
  recordBookingCheckoutExcessRefund,
} from '../bookings/index.js';
import type { BatchAllocation } from '@capella/contracts';

type Database = ReturnType<typeof createDatabase>;
type Support = Pick<ReturnType<typeof createSaleRepositorySupport>,
  'projectCommission' | 'findByIdempotencyKey'>;

export const createSaleRepositoryComplete = (
  database: Database,
  audit: ErpAuditCapability,
  payroll: ErpPayrollCapability | undefined,
  { projectCommission, findByIdempotencyKey }: Support,
): Pick<SaleRepository, 'complete'> => ({
    async complete(operation: CompleteSaleOperation) {
      try {
        const outcome = await database.transaction(async (transaction) => {
          const { input } = operation;          const serviceInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'service' }> => line.itemType === 'service');
          const productInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'product' }> => line.itemType === 'product');
          // Every line names the employee who performed or sold it; the invoice as
          // a whole names none, so one sale can pay several people. A transfer
          // between branches names nobody.
          const employeeIds = [...new Set([
            ...serviceInputs.map((line) => line.employeeId),
            ...productInputs.flatMap((line) => (
              line.employeeId === undefined ? [] : [line.employeeId]
            )),
          ])].sort((left, right) => left - right);
          if (serviceInputs.some((line) => line.employeeId === undefined)
            || (operation.kind !== 'branch_transfer'
              && productInputs.some((line) => line.employeeId === undefined))
            || (employeeIds.length > 0 && operation.assertEmployees === undefined)) {
            throw new SaleError('SALE_VALIDATION_FAILED');
          }
          // A shift is spent once it passes its sixteen hours, whether or not the
          // sweep has written the close yet, so no sale can slip in behind it.
          const session = (await transaction.select().from(cashierSessions).where(and(
            eq(cashierSessions.id, input.cashierSessionId),
            eq(cashierSessions.branchId, input.branchId),
            isNull(cashierSessions.closedAt),
            // Strictly after the limit: the sweep spends a shift that reaches it.
            gt(
              cashierSessions.openedAt,
              new Date(operation.soldAt.getTime() - CASHIER_SESSION_MAX_DURATION_MS),
            ),
          )).for('update').limit(1))[0];
          if (!session || (operation.actingAccountRole === 'cashier'
            && session.openedByAccountId !== operation.actingAccountId)) {
            throw new SaleError('CASHIER_SESSION_NOT_OPEN');
          }
          const client = (await transaction.select().from(clients).where(and(
            eq(clients.id, input.clientId),
            eq(clients.branchId, input.branchId),
          )).limit(1))[0];
          if (!client) throw new SaleError('CLIENT_NOT_FOUND');
          const account = (await transaction.select({
            username: accounts.username,
            role: accounts.role,
            employeeId: accounts.employeeId,
            active: accounts.active,
          }).from(accounts).where(eq(accounts.id, operation.actingAccountId))
            .for('update').limit(1))[0];
          if (!account || !account.active || account.role !== operation.actingAccountRole) {
            throw new SaleError('CASHIER_SESSION_NOT_OPEN');
          }
          if (payroll) {
            // Lock every assigned employee conservatively before rows are read.
            // The final projection below still includes only employees who
            // actually earned commission from the authoritative locked rows.
            for (const employeeId of employeeIds) {
              await payroll.lockCommissionEmployee(employeeId, transaction);
            }
          }
          const assignedEmployees = employeeIds.length
            ? await operation.assertEmployees!(transaction)
            : [];
          const employeeById = new Map(assignedEmployees.map((row) => [row.id, row]));
          if (employeeIds.some((id) => !employeeById.has(id))) {
            throw new SaleError('EMPLOYEE_NOT_ASSIGNABLE');
          }
          // Held booking money is settled inside this sale, so the booking row
          // locks here — after session, account and employees — before any
          // money row or queue ticket is written. A booking not waiting for its
          // client can never be sold.
          if (input.bookingId !== undefined) {
            const booking = (await transaction.select().from(erpBookings).where(and(
              eq(erpBookings.id, input.bookingId),
              eq(erpBookings.branchId, input.branchId),
            )).for('update').limit(1))[0];
            // The concurrent twin of this exact request may have just stored the
            // invoice. It is looked up under the booking's lock, before any other
            // guard, and by key rather than by booking status — so a twin of a
            // partial sale replays too, and the stored request is compared with
            // this one before its invoice is handed back.
            const storedNow = (await transaction.select({ id: invoices.id }).from(invoices)
              .where(eq(invoices.idempotencyKey, input.idempotencyKey)).for('update').limit(1))[0];
            if (storedNow) {
              return { replayId: storedNow.id };
            }
            if (!booking || booking.clientId !== input.clientId || booking.status !== 'arrived') {
              throw new SaleError('BOOKING_NOT_PENDING');
            }
          }
          const quotedLines = await quoteServices(transaction, input.branchId, serviceInputs, true);
          const quotedProducts = await quoteProducts(
            transaction, input.branchId, productInputs, true, operation.pricing,
          );
          const serviceIds = [...new Set(serviceInputs.map(({ serviceId }) => serviceId))];
          const currentQueueEntries = serviceIds.length ? await transaction.select({
            serviceId: serviceQueueEntries.serviceId,
            queueNumber: serviceQueueEntries.queueNumber,
          }).from(serviceQueueEntries).where(and(
            eq(serviceQueueEntries.cashierSessionId, input.cashierSessionId),
            inArray(serviceQueueEntries.serviceId, serviceIds),
          )) : [];
          const nextQueueNumber = new Map<number, number>();
          for (const entry of currentQueueEntries) {
            nextQueueNumber.set(
              entry.serviceId,
              Math.max(nextQueueNumber.get(entry.serviceId) ?? 1, entry.queueNumber + 1),
            );
          }
          const serviceRows = serviceIds.length ? await transaction.select({
            id: erpServices.id,
            commissionPercent: erpServices.commissionPercent,
          }).from(erpServices).where(inArray(erpServices.id, serviceIds)) : [];
          // An override belongs to one employee, so the same service can pay two
          // different rates on the same invoice.
          const overrides = serviceIds.length ? await transaction.select().from(erpServiceCommissionOverrides)
            .where(and(
              inArray(erpServiceCommissionOverrides.serviceId, serviceIds),
              inArray(erpServiceCommissionOverrides.employeeId, employeeIds),
            )) : [];
          const defaultRates = new Map(serviceRows.map((service) => [
            service.id, service.commissionPercent,
          ]));
          const overrideRates = new Map(overrides.map((override) => [
            `${override.serviceId}:${override.employeeId}`, override.commissionPercent,
          ]));
          const calculatedServices = quotedLines.map((line, index) => {
            const employee = employeeById.get(serviceInputs[index]!.employeeId)!;
            const override = overrideRates.get(`${line.sourceId}:${employee.id}`);
            const rule = override === undefined ? 'service_default' as const : 'employee_override' as const;
            const rate = override ?? defaultRates.get(line.sourceId)!;
            return {
              ...line,
              employee,
              commissionRule: rule,
              commissionRate: rate,
              commissionAmount: calculateCommission(line.lineTotal, rate),
              balanceBefore: undefined,
            };
          });
          const calculatedProducts = quotedProducts.map((line, index) => {
            // A zero-commission product still records who sold it; assignment and
            // earning commission are separate facts.
            const employee = productInputs[index]!.employeeId === undefined
              ? null
              : employeeById.get(productInputs[index]!.employeeId) ?? null;
            const earns = employee !== null && Number(line.commissionPercent ?? 0) > 0;
            return {
              ...line,
              employee,
              commissionRule: earns ? 'service_default' as const : 'none' as const,
              commissionRate: earns ? line.commissionPercent : '0.00',
              commissionAmount: earns ? calculateCommission(line.lineTotal, line.commissionPercent) : '0.00',
            };
          });
          const byKey = keyedQueues([...calculatedServices, ...calculatedProducts]);
          const calculatedLines = input.lines.map((line) => byKey.get(`${line.itemType}:${line.itemType === 'service' ? line.serviceId : line.productId}`)!.shift()!);
          const projectedEmployeeIds = [...new Set(calculatedLines.flatMap((line) => (
            line.employee && line.commissionRule !== 'none' ? [line.employee.id] : []
          )))].sort((left, right) => left - right);
          let totals;
          try {
            totals = calculateSaleTotals({
              lineTotals: calculatedLines.map(({ lineTotal }) => lineTotal),
              ...(input.discount ? { discount: input.discount } : {}),
              ...(input.tax ? { tax: input.tax } : {}),
              payments: input.payments,
            });
          } catch (error) {
            if (error instanceof MoneyCalculationError) {
              throw new SaleError('SALE_VALIDATION_FAILED');
            }
            throw error;
          }
          // Up-front money is used first and automatically: the credit must be
          // exactly min(held, total), read under the booking's lock.
          const bookingCreditCents = input.bookingId === undefined
            ? 0n
            : toCents(input.bookingCredit ?? '0.00');
          let bookingExcessCents = 0n;
          if (input.bookingId !== undefined) {
            const { heldCents, leftoverValueCents } = await readBookingCreditContext(
              transaction, input.bookingId, serviceInputs.map(({ serviceId }) => serviceId),
            );
            const expected = heldCents < toCents(totals.total) ? heldCents : toCents(totals.total);
            if (bookingCreditCents !== expected) {
              throw new SaleError('BOOKING_CREDIT_MISMATCH');
            }
            // Held money still covering the services left waiting stays held; only
            // what goes beyond them is excess.
            const heldAfterCents = heldCents - bookingCreditCents;
            bookingExcessCents = heldAfterCents > leftoverValueCents
              ? heldAfterCents - leftoverValueCents
              : 0n;
          }
          // A discount made the invoice worth less than the client paid up front.
          // The cashier is holding that money now, so it goes back in this same
          // sale: a booking that ends up fully sold has no other refund path, and
          // held money above a fully sold booking blocks the shift close for good.
          // A refund the server would not hand back is refused, never dropped:
          // the replay could not rebuild it and every retry would conflict.
          if (bookingExcessCents === 0n && input.bookingRefund) {
            throw new SaleError('BOOKING_REFUND_AMOUNT_MISMATCH');
          }
          if (bookingExcessCents > 0n) {
            const refund = input.bookingRefund;
            if (!refund) throw new SaleError('BOOKING_REFUND_REQUIRED');
            const offered = refund.payments.reduce(
              (sum, payment) => sum + toCents(payment.amount), 0n,
            );
            if (offered !== bookingExcessCents) {
              throw new SaleError('BOOKING_REFUND_AMOUNT_MISMATCH');
            }
            await recordBookingCheckoutExcessRefund(transaction, {
              bookingId: input.bookingId!,
              branchId: input.branchId,
              cashierSessionId: input.cashierSessionId,
              actingAccountId: operation.actingAccountId,
              at: operation.soldAt,
              operationReference: input.idempotencyKey,
              payments: refund.payments,
            });
          }
          const paidCents = toCents(totals.paymentTotal) + bookingCreditCents;
          if (paidCents > toCents(totals.total)) {
            throw new SaleError('PAYMENT_TOTAL_MISMATCH');
          }
          if (serviceInputs.length && paidCents !== toCents(totals.total)) {
            throw new SaleError('PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES');
          }

          // Explicit choices reserve their batches first, so an automatic sibling
          // cannot take the batch the cashier deliberately chose later in the basket.
          const batchesByLine = new Map<number, BatchAllocation[]>();
          for (const productId of [...new Set(quotedProducts.map((line) => line.sourceId))].sort((a, b) => a - b)) {
            const originalBalance = Math.max(...quotedProducts.filter((line) => line.sourceId === productId).map((line) => line.balanceBefore));
            await ensureLegacyBatch(transaction, productId, input.branchId, originalBalance, '0.000', operation.soldAt);
          }
          const batchOrder = input.lines.map((line, index) => ({ line, index }))
            .filter((entry) => entry.line.itemType === 'product')
            .sort((a, b) => Number(b.line.itemType === 'product' && b.line.batches !== undefined)
              - Number(a.line.itemType === 'product' && a.line.batches !== undefined) || a.index - b.index);
          for (const { line, index } of batchOrder) {
            if (line.itemType === 'product') batchesByLine.set(index, await takeBatchQuantities(
              transaction, line.productId, input.branchId, `${line.quantity}.000`, 'quantity', operation.soldAt, line.batches,
            ));
          }
          const inserted = await transaction.insert(invoices).values({
            branchId: input.branchId,
            clientId: input.clientId,
            sellerEmployeeId: null,
            actingAccountId: operation.actingAccountId,
            cashierSessionId: input.cashierSessionId,
            invoiceNumber: operation.invoiceNumber,
            idempotencyKey: input.idempotencyKey,
            kind: operation.kind ?? 'sale',
            clientNameSnapshot: client.fullName,
            clientPhoneSnapshot: client.phone,
            sellerNameSnapshot: null,
            authorizedBySnapshot: account.username,
            subtotal: totals.subtotal,
            discountKind: input.discount?.kind ?? null,
            discountValue: input.discount?.value ?? null,
            discountAmount: totals.discountAmount,
            taxKind: input.tax?.kind ?? null,
            taxValue: input.tax?.value ?? null,
            taxAmount: totals.taxAmount,
            total: totals.total,
            amountPaid: operation.kind === 'branch_transfer' ? '0.00' : signedMoney(paidCents),
            creditedAmount: operation.kind === 'branch_transfer' ? totals.total : '0.00',
            settlementStatus: operation.kind === 'branch_transfer'
              || paidCents === toCents(totals.total) ? 'settled' : 'open',
            soldAt: operation.soldAt,
            createdAt: operation.soldAt,
          });
          const invoiceId = Number(inserted[0].insertId);
          for (const [index, line] of calculatedLines.entries()) {
            const batches = batchesByLine.get(index) ?? null;
            const requested = input.lines[index]!;
            const insertedLine = await transaction.insert(invoiceLines).values({
              batches,
              requestedBatches: requested.itemType === 'product' ? requested.batches ?? null : null,
              invoiceId,
              branchId: input.branchId,
              lineNumber: index + 1,
              itemType: line.itemType,
              serviceId: line.itemType === 'service' ? line.sourceId : null,
              productId: line.itemType === 'product' ? line.sourceId : null,
              itemNameSnapshot: line.name,
              employeeId: line.employee?.id ?? null,
              employeeNameSnapshot: line.employee?.fullName ?? null,
              employeeCodeSnapshot: line.employee?.employeeCode ?? null,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              commissionRuleSnapshot: line.commissionRule,
              commissionRateSnapshot: line.commissionRate,
              commissionAmountSnapshot: line.commissionAmount,
              productCostBasisSnapshot: line.itemType === 'product' ? line.productCostBasis : null,
            });
            const invoiceLineId = Number(insertedLine[0].insertId);
            if (line.itemType === 'service') {
              const firstQueueNumber = nextQueueNumber.get(line.sourceId) ?? 1;
              await transaction.insert(serviceQueueEntries).values(
                Array.from({ length: line.quantity }, (_, offset) => ({
                  invoiceId,
                  invoiceLineId,
                  branchId: input.branchId,
                  cashierSessionId: input.cashierSessionId,
                  serviceId: line.sourceId,
                  employeeId: line.employee.id,
                  queueNumber: firstQueueNumber + offset,
                  createdAt: operation.soldAt,
                })),
              );
              nextQueueNumber.set(line.sourceId, firstQueueNumber + line.quantity);
            }
            if (line.employee && line.commissionRule !== 'none') {
              await transaction.insert(commissionLedgerEntries).values({
                invoiceId, invoiceLineId, employeeId: line.employee.id,
                actingAccountId: operation.actingAccountId, entryType: 'earned',
                commissionRuleSnapshot: line.commissionRule, commissionRateSnapshot: line.commissionRate,
                baseAmount: line.lineTotal, amount: line.commissionAmount, createdAt: operation.soldAt,
              });
            }
            if (line.itemType === 'product') {
              const balanceAfter = line.balanceBefore - line.quantity;
              await transaction.update(erpProductStocks).set({ quantity: balanceAfter, updatedAt: operation.soldAt }).where(and(
                eq(erpProductStocks.productId, line.sourceId), eq(erpProductStocks.branchId, input.branchId),
              ));
              await transaction.insert(erpStockMovements).values({
                batches, productId: line.sourceId, branchId: input.branchId, reason: 'sale', sourceType: 'sale', sourceId: invoiceId,
                quantityDelta: -line.quantity, balanceAfter, actingAccountId: operation.actingAccountId, createdAt: operation.soldAt,
              });
            }
          }
          if (input.payments.length > 0) await transaction.insert(invoicePayments).values(input.payments.map((payment) => ({
            invoiceId,
            method: payment.method,
            amount: payment.amount,
            operationReference: randomUUID(),
            isInitial: true,
            // Money is attributed to the shift and the account that took it, so a
            // later instalment can belong to a later shift than the invoice.
            cashierSessionId: input.cashierSessionId,
            actingAccountId: operation.actingAccountId,
            paidAt: operation.soldAt,
            createdAt: operation.soldAt,
          })));
          // Held booking money spent here is a stored payment fact on the invoice,
          // not cash that entered the drawer at the till.
          if (bookingCreditCents > 0n) {
            await transaction.insert(invoicePayments).values({
              invoiceId,
              method: 'booking_credit',
              amount: signedMoney(bookingCreditCents),
              operationReference: randomUUID(),
              isInitial: true,
              bookingId: input.bookingId!,
              cashierSessionId: input.cashierSessionId,
              actingAccountId: operation.actingAccountId,
              paidAt: operation.soldAt,
              createdAt: operation.soldAt,
            });
          }
          const amountPaid = input.payments.reduce((sum, payment) => sum + toCents(payment.amount), 0n)
            + bookingCreditCents;
          await transaction.update(invoices).set({
            status: 'completed',
            amountPaid: operation.kind === 'branch_transfer' ? '0.00' : signedMoney(amountPaid),
            creditedAmount: operation.kind === 'branch_transfer' ? totals.total : '0.00',
            settlementStatus: operation.kind === 'branch_transfer'
              || amountPaid === toCents(totals.total) ? 'settled' : 'open',
          })
            .where(eq(invoices.id, invoiceId));
          for (const employeeId of projectedEmployeeIds) {
            await projectCommission(transaction, employeeId, cairoMonth(operation.soldAt));
          }
          const completed = await hydrateInvoice(transaction, invoiceId);
          if (!completed) throw new Error('Completed invoice could not be reloaded');
          await audit.record(transaction, {
            module: 'erp-sales',
            action: 'complete',
            entityType: 'invoice',
            entityId: invoiceId,
            afterState: completed,
            relatedIds: {
              branchId: input.branchId,
              clientId: input.clientId,
              ...(employeeIds.length ? { employeeIds: employeeIds.join(',') } : {}),
              cashierSessionId: input.cashierSessionId,
            },
            createdAt: operation.soldAt,
          });
          // The receiving branch of a transfer settles here, so the sale and the
          // stock it moved either both commit or both roll back.
          await operation.afterInvoice?.(transaction, completed);
          return completed;
        });
        if (outcome && typeof outcome === 'object' && 'replayId' in outcome) {
          // Read outside this transaction: its snapshot predates the twin's
          // commit, so it cannot see the stored invoice's rows. A stored invoice
          // is only this request's answer when the stored request is the same.
          const replay = await hydrateInvoice(database, outcome.replayId);
          if (!replay) throw new SaleError('IDEMPOTENCY_CONFLICT');
          if (!isDeepStrictEqual(await reconstructInput(database, replay.id), operation.input)) {
            throw new SaleError('IDEMPOTENCY_CONFLICT');
          }
          return replay;
        }
        return outcome;
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const existing = await findByIdempotencyKey(operation.input.idempotencyKey, {
          actingAccountId: operation.actingAccountId,
          actingAccountRole: operation.actingAccountRole,
        });
        if (!existing) throw new SaleError('IDEMPOTENCY_CONFLICT');
        if (!isDeepStrictEqual(existing.input, operation.input)) {
          throw new SaleError('IDEMPOTENCY_CONFLICT');
        }
        return existing.invoice;
      }
    }

});


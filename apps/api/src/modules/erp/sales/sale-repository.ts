import { type createDatabase } from '@capella/database';
import {
  accounts,
  branchCashierRoster,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  erpProductStocks,
  erpStockMovements,
  erpServiceCommissionOverrides,
  erpServices,
  employees,
  invoiceLines,
  invoiceLineReassignments,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
  serviceQueueEntries,
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
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { ErpAuditCapability, ErpPayrollCapability } from '../hr-capabilities.js';
import { cairoMonth } from '../cairo-calendar.js';
import { CASHIER_SESSION_MAX_DURATION_MS } from './cashier-sessions-service.js';
import { SaleError, type CompleteSaleOperation, type ReassignInvoiceLineOperation, type RecordInvoicePaymentOperation, type ReverseInvoiceOperation, type SaleRepository } from './sale-service.js';
import {
  allocateReversalAmounts,
  calculateCommission,
  calculateSaleTotals,
  MoneyCalculationError,
  sumMoney,
  toCents,
} from './services/sale-calculations.js';

import { hydrateInvoice, keyedQueues, quoteProducts, quoteServices, quoteSale } from './sale-repository-read.js';
import { createSaleRepositoryQueries } from './sale-repository-queries.js';
import { createSaleRepositorySupport } from './sale-repository-support.js';

type Database = ReturnType<typeof createDatabase>;

const isDuplicateEntryError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;
  if (Reflect.get(error, 'code') === 'ER_DUP_ENTRY') return true;
  const cause: unknown = Reflect.get(error, 'cause');
  return typeof cause === 'object' && cause !== null
    && Reflect.get(cause, 'code') === 'ER_DUP_ENTRY';
};

const signedMoney = (value: bigint) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};
const commissionCents = (base: bigint, rate: string) => (
  (base * toCents(rate) + 5_000n) / 10_000n
);
const invoiceBusinessDate = (invoiceNumber: string) => invoiceNumber.slice(4, 14).replaceAll('.', '-');
const cairoDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
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

    async complete(operation: CompleteSaleOperation) {
      try {
        return await database.transaction(async (transaction) => {
          const { input } = operation;
          const serviceInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'service' }> => line.itemType === 'service');
          const productInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'product' }> => line.itemType === 'product');
          // Every service names the employee who performed it; the invoice as a
          // whole names none, so one sale can pay several people.
          const employeeIds = [...new Set(serviceInputs.map((line) => line.employeeId))]
            .sort((left, right) => left - right);
          if (serviceInputs.length && (
            employeeIds.some((employeeId) => employeeId === undefined)
            || operation.assertEmployees === undefined
          )) {
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
          // The seller must still be on the branch roster when the sale settles.
          // A transfer between branches has none: no person sold anything, and
          // products earn no commission, so the invoice records no seller.
          const seller = input.sellerEmployeeId === undefined ? null
            : (await transaction.select({
              id: employees.id,
              fullName: employees.fullName,
              employeeCode: employees.employeeCode,
            }).from(branchCashierRoster).innerJoin(employees, and(
              eq(employees.id, branchCashierRoster.employeeId),
              eq(employees.branchId, branchCashierRoster.branchId),
            )).where(and(
              eq(branchCashierRoster.branchId, input.branchId),
              eq(branchCashierRoster.employeeId, input.sellerEmployeeId),
              eq(employees.employmentStatus, 'active'),
              isNull(employees.deletedAt),
            )).for('update').limit(1))[0];
          if (input.sellerEmployeeId !== undefined && !seller) {
            throw new SaleError('SELLER_NOT_ON_ROSTER');
          }
          if (payroll) {
            // Lock a product seller conservatively before product rows are read.
            // The final projection below still includes only employees who
            // actually earned commission from the authoritative locked rows.
            const lockEmployeeIds = [...new Set([
              ...employeeIds,
              ...(seller && productInputs.length ? [seller.id] : []),
            ])].sort((left, right) => left - right);
            for (const employeeId of lockEmployeeIds) {
              await payroll.lockCommissionEmployee(employeeId, transaction);
            }
          }
          const assignedEmployees = serviceInputs.length
            ? await operation.assertEmployees!(transaction)
            : [];
          const employeeById = new Map(assignedEmployees.map((row) => [row.id, row]));
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
          const calculatedProducts = quotedProducts.map((line) => ({
            ...line,
            employee: seller && Number(line.commissionPercent ?? 0) > 0 ? { id: seller.id, fullName: seller.fullName, employeeCode: seller.employeeCode } : null,
            commissionRule: seller && Number(line.commissionPercent ?? 0) > 0 ? 'service_default' as const : 'none' as const,
            commissionRate: seller && Number(line.commissionPercent ?? 0) > 0 ? line.commissionPercent : '0.00',
            commissionAmount: seller && Number(line.commissionPercent ?? 0) > 0 ? calculateCommission(line.lineTotal, line.commissionPercent) : '0.00',
          }));
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
          if (toCents(totals.paymentTotal) > toCents(totals.total)) {
            throw new SaleError('PAYMENT_TOTAL_MISMATCH');
          }
          if (serviceInputs.length && totals.paymentTotal !== totals.total) {
            throw new SaleError('PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES');
          }

          const inserted = await transaction.insert(invoices).values({
            branchId: input.branchId,
            clientId: input.clientId,
            sellerEmployeeId: seller?.id ?? null,
            actingAccountId: operation.actingAccountId,
            cashierSessionId: input.cashierSessionId,
            invoiceNumber: operation.invoiceNumber,
            idempotencyKey: input.idempotencyKey,
            kind: operation.kind ?? 'sale',
            clientNameSnapshot: client.fullName,
            clientPhoneSnapshot: client.phone,
            sellerNameSnapshot: seller?.fullName ?? null,
            authorizedBySnapshot: account.username,
            subtotal: totals.subtotal,
            discountKind: input.discount?.kind ?? null,
            discountValue: input.discount?.value ?? null,
            discountAmount: totals.discountAmount,
            taxKind: input.tax?.kind ?? null,
            taxValue: input.tax?.value ?? null,
            taxAmount: totals.taxAmount,
            total: totals.total,
            amountPaid: totals.paymentTotal,
            settlementStatus: totals.paymentTotal === totals.total ? 'settled' : 'open',
            soldAt: operation.soldAt,
            createdAt: operation.soldAt,
          });
          const invoiceId = Number(inserted[0].insertId);
          for (const [index, line] of calculatedLines.entries()) {
            const insertedLine = await transaction.insert(invoiceLines).values({
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
                productId: line.sourceId, branchId: input.branchId, reason: 'sale', sourceType: 'sale', sourceId: invoiceId,
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
          const amountPaid = input.payments.reduce((sum, payment) => sum + toCents(payment.amount), 0n);
          await transaction.update(invoices).set({
            status: 'completed',
            amountPaid: signedMoney(amountPaid),
            settlementStatus: amountPaid === toCents(totals.total) ? 'settled' : 'open',
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
              ...(seller ? { sellerEmployeeId: seller.id } : {}),
              cashierSessionId: input.cashierSessionId,
            },
            createdAt: operation.soldAt,
          });
          // The receiving branch of a transfer settles here, so the sale and the
          // stock it moved either both commit or both roll back.
          await operation.afterInvoice?.(transaction, completed);
          return completed;
        });
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
    },

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
        const amountPaid = signedMoney(
          toCents(original.amountPaid) + toCents(operation.input.amount),
        );
        await transaction.update(invoices).set({
          amountPaid,
          settlementStatus: toCents(amountPaid) + toCents(original.creditedAmount) === toCents(original.total)
            ? 'settled' : 'open',
        }).where(eq(invoices.id, original.id));
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
    },

    async reassignLine(operation: ReassignInvoiceLineOperation) {
      const existing = await existingReassignment(operation);
      if (existing) return existing;
      try {
        return await database.transaction(async (transaction) => {
          const invoice = (await transaction.select().from(invoices).where(and(
            eq(invoices.id, operation.invoiceId),
            eq(invoices.branchId, operation.input.branchId),
          )).for('update').limit(1))[0];
          if (!invoice) throw new SaleError('INVOICE_NOT_FOUND');
          if (invoice.status !== 'completed') throw new SaleError('INVOICE_NOT_REASSIGNABLE');
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
            baseAmount: line.lineTotal,
            createdAt: operation.reassignedAt,
          };
          await transaction.insert(commissionLedgerEntries).values({
            ...ledgerBase,
            employeeId: fromEmployeeId,
            entryType: 'reassignment_out' as const,
            amount: signedMoney(-toCents(line.commissionAmountSnapshot)),
          });
          await transaction.insert(commissionLedgerEntries).values({
            ...ledgerBase,
            employeeId: target.id,
            entryType: 'reassignment_in' as const,
            amount: line.commissionAmountSnapshot,
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
      const commissionEmployeeIds = [...new Set([
        ...invoiceEmployeeIds, ...reassignedEmployeeIds,
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
            && invoiceBusinessDate(original.invoiceNumber) !== cairoDate(operation.reversedAt)) {
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
          for (const line of originalLines.filter((candidate) => (
            candidate.itemType === 'service' && selectedByLine.has(candidate.id)
          ))) {
            const queueIds = (await transaction.select({ id: serviceQueueEntries.id })
              .from(serviceQueueEntries).where(and(
                eq(serviceQueueEntries.invoiceLineId, line.id),
                inArray(serviceQueueEntries.status, ['pending', 'overdue']),
              )).orderBy(desc(serviceQueueEntries.queueNumber))
              .limit(selectedByLine.get(line.id)!).for('update')).map(({ id }) => id);
            if (queueIds.length) {
              await transaction.update(serviceQueueEntries).set({ status: 'canceled' })
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
            const currentAssignment = line.itemType === 'service'
              ? assignmentHistory.find((entry) => entry.invoiceLineId === line.id)
              : undefined;
            const earned = currentAssignment
              ? ledger.find((entry) => (
                entry.invoiceLineReassignmentId === currentAssignment.id
                && entry.entryType === 'reassignment_in'
              ))!
              : ledger.find((entry) => (
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
    },

    ...createSaleRepositoryQueries(database, listInvoiceEmployees),

  };
  return repository;
};

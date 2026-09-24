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
import { hydrateInvoice, keyedQueues, quoteProducts, quoteServices } from './sale-repository-read.js';
import { isDuplicateEntryError, signedMoney } from './sale-repository-money.js';
import type { createSaleRepositorySupport } from './sale-repository-support.js';

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
            amountPaid: operation.kind === 'branch_transfer' ? '0.00' : totals.paymentTotal,
            creditedAmount: operation.kind === 'branch_transfer' ? totals.total : '0.00',
            settlementStatus: operation.kind === 'branch_transfer'
              || totals.paymentTotal === totals.total ? 'settled' : 'open',
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
    }

});


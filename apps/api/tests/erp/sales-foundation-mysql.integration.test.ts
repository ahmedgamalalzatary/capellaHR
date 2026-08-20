import { createDatabase } from '@capella/database';
import {
  accounts,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  employees,
  erpCategories,
  erpServices,
  invoiceDailySequences,
  invoiceLines,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDrizzleInvoiceSequenceStore } from '../../src/modules/erp/sales/invoice-sequence-store.js';

const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) {
  throw new Error('DATABASE_URL is required for ERP sales foundation MySQL integration tests');
}
const controlDatabase = createDatabase(sourceDatabaseUrl);
const databaseName = `capella_hr_test_erp8_${process.pid}_${Date.now()}`;
const databaseUrl = new URL(sourceDatabaseUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabase(databaseUrl.toString());

beforeAll(async () => {
  if (!/^capella_hr_test_erp8_\d+_\d+$/.test(databaseName)) {
    throw new Error('Unsafe ERP 8 integration database name');
  }
  await controlDatabase.execute(sql.raw(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ));
  await migrate(database, {
    migrationsFolder: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/database/migrations',
    ),
  });
}, 120_000);

afterAll(async () => {
  const failures: unknown[] = [];
  try { await database.$client.promise().end(); } catch (error) { failures.push(error); }
  try {
    await controlDatabase.execute(sql.raw(`DROP DATABASE IF EXISTS \`${databaseName}\``));
  } catch (error) { failures.push(error); }
  try { await controlDatabase.$client.promise().end(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, 'ERP sales foundation cleanup failed');
}, 30_000);

describe('ERP sales foundation MySQL integration', () => {
  it('allocates one non-reusable daily sequence under concurrency', async () => {
    const businessDate = '2037-12-31';
    await database.delete(invoiceDailySequences)
      .where(eq(invoiceDailySequences.businessDate, businessDate));
    const store = createDrizzleInvoiceSequenceStore(database);

    const values = await Promise.all(Array.from({ length: 20 }, () => (
      store.allocate(businessDate, new Date('2037-12-31T10:00:00.000Z'))
    )));

    expect([...values].sort((left, right) => left - right))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    await database.delete(invoiceDailySequences)
      .where(eq(invoiceDailySequences.businessDate, businessDate));
  });

  it('enforces paid completion and valid immutable commission lineage', async () => {
    const marker = `erp8-${Date.now()}-${Math.random()}`;

    await expect(database.transaction(async (transaction) => {
      const now = new Date('2026-08-03T10:00:00.000Z');
      const branchId = Number((await transaction.insert(branches).values({
        name: marker,
        nameNormalized: marker,
        location: 'Cairo',
        latitude: 30,
        longitude: 31,
        gpsAccuracyMeters: 5,
        attendanceRadiusMeters: 100,
        createdAt: now,
        updatedAt: now,
      }))[0].insertId);
      const employeeId = Number((await transaction.insert(employees).values({
        employeeCode: 1_800_000_000 + Math.floor(Math.random() * 100_000_000),
        fullName: marker,
        personalPhone: `010${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
        whatsappPhone: `011${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
        pinHash: 'unused',
        age: 30,
        address: 'Cairo',
        branchId,
        shiftDurationMinutes: 480,
        monthlyBaseSalary: '5000.00',
        createdAt: now,
        updatedAt: now,
      }))[0].insertId);
      const accountId = Number((await transaction.insert(accounts).values({
        username: marker,
        passwordHash: 'unused',
        role: 'cashier',
        employeeId,
        createdAt: now,
        updatedAt: now,
      }))[0].insertId);
      const clientId = Number((await transaction.insert(clients).values({
        branchId,
        fullName: marker,
        phone: `012${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
        createdAt: now,
        updatedAt: now,
      }))[0].insertId);
      const categoryId = Number((await transaction.insert(erpCategories).values({
        branchId,
        type: 'service',
        name: marker,
        nameNormalized: marker,
        createdAt: now,
        updatedAt: now,
      }))[0].insertId);
      const serviceId = Number((await transaction.insert(erpServices).values({
        branchId,
        categoryId,
        name: marker,
        nameNormalized: marker,
        price: '0.04',
        commissionPercent: '33.33',
        createdAt: now,
        updatedAt: now,
      }))[0].insertId);
      const cashierSessionId = Number((await transaction.insert(cashierSessions).values({
        branchId,
        openedByAccountId: accountId,
        openedAt: now,
      }))[0].insertId);
      const invoiceId = Number((await transaction.insert(invoices).values({
        branchId,
        clientId,
        sellerEmployeeId: employeeId,
        actingAccountId: accountId,
        cashierSessionId,
        invoiceNumber: `INV-2026.08.03-13.00-${branchId}`,
        idempotencyKey: `00000000-0000-4000-8000-${String(branchId).padStart(12, '0')}`,
        clientNameSnapshot: marker,
        clientPhoneSnapshot: '01212345678',
        sellerNameSnapshot: marker,
        authorizedBySnapshot: marker,
        subtotal: '0.04',
        discountAmount: '0.00',
        taxAmount: '0.00',
        total: '0.04',
        soldAt: now,
        createdAt: now,
      }))[0].insertId);
      const lineId = Number((await transaction.insert(invoiceLines).values({
        invoiceId,
        branchId,
        lineNumber: 1,
        itemType: 'service',
        serviceId,
        itemNameSnapshot: marker,
        employeeId,
        employeeNameSnapshot: marker,
        employeeCodeSnapshot: 123,
        quantity: 1,
        unitPrice: '0.04',
        lineTotal: '0.04',
        commissionRuleSnapshot: 'service_default',
        commissionRateSnapshot: '33.33',
        commissionAmountSnapshot: '0.01',
      }))[0].insertId);

      const emptyInvoiceId = Number((await transaction.insert(invoices).values({
        branchId,
        clientId,
        sellerEmployeeId: employeeId,
        actingAccountId: accountId,
        cashierSessionId,
        invoiceNumber: `INV-2026.08.03-13.01-${branchId}`,
        idempotencyKey: `10000000-0000-4000-8000-${String(branchId).padStart(12, '0')}`,
        clientNameSnapshot: marker,
        clientPhoneSnapshot: '01212345678',
        sellerNameSnapshot: marker,
        authorizedBySnapshot: marker,
        subtotal: '0.04',
        discountAmount: '0.00',
        taxAmount: '0.00',
        total: '0.04',
        soldAt: now,
        createdAt: now,
      }))[0].insertId);

      let invalidStatusRejected = false;
      try {
        await transaction.update(invoices).set({ status: 'refunded' })
          .where(eq(invoices.id, emptyInvoiceId));
      } catch {
        invalidStatusRejected = true;
      }
      await transaction.insert(invoicePayments).values({
        invoiceId: emptyInvoiceId,
        method: 'cash',
        amount: '0.04',
        cashierSessionId,
        actingAccountId: accountId,
        paidAt: now,
        createdAt: now,
      });
      let emptyCompletionRejected = false;
      try {
        await transaction.update(invoices).set({ status: 'completed' })
          .where(eq(invoices.id, emptyInvoiceId));
      } catch {
        emptyCompletionRejected = true;
      }

      let unpaidCompletionRejected = false;
      try {
        await transaction.update(invoices).set({ status: 'completed' })
          .where(eq(invoices.id, invoiceId));
      } catch {
        unpaidCompletionRejected = true;
      }
      await transaction.insert(invoicePayments).values({
        invoiceId,
        method: 'cash',
        amount: '0.04',
        cashierSessionId,
        actingAccountId: accountId,
        paidAt: now,
        createdAt: now,
      });

      await transaction.update(invoices).set({ subtotal: '0.05', total: '0.05' })
        .where(eq(invoices.id, invoiceId));
      await transaction.update(invoicePayments).set({ amount: '0.05' })
        .where(eq(invoicePayments.invoiceId, invoiceId));
      let lineSubtotalMismatchRejected = false;
      try {
        await transaction.update(invoices).set({ status: 'completed' })
          .where(eq(invoices.id, invoiceId));
      } catch {
        lineSubtotalMismatchRejected = true;
      }
      await transaction.update(invoices).set({ subtotal: '0.04', total: '0.04' })
        .where(eq(invoices.id, invoiceId));
      await transaction.update(invoicePayments).set({ amount: '0.04' })
        .where(eq(invoicePayments.invoiceId, invoiceId));

      let missingCommissionRejected = false;
      try {
        await transaction.update(invoices).set({ status: 'completed' })
          .where(eq(invoices.id, invoiceId));
      } catch {
        missingCommissionRejected = true;
      }

      const ledgerId = Number((await transaction.insert(commissionLedgerEntries).values({
        invoiceId,
        invoiceLineId: lineId,
        employeeId,
        actingAccountId: accountId,
        entryType: 'earned',
        commissionRuleSnapshot: 'service_default',
        commissionRateSnapshot: '33.33',
        baseAmount: '0.04',
        amount: '0.01',
        createdAt: now,
      }))[0].insertId);

      await transaction.update(invoices).set({ status: 'completed' })
        .where(eq(invoices.id, invoiceId));

      let paymentInsertRejected = false;
      let paymentUpdateRejected = false;
      let paymentDeleteRejected = false;
      try {
        await transaction.insert(invoicePayments).values({
          invoiceId,
          method: 'visa',
          amount: '1.00',
          cashierSessionId,
          actingAccountId: accountId,
          paidAt: now,
          createdAt: now,
        });
      } catch {
        paymentInsertRejected = true;
      }
      try {
        await transaction.update(invoicePayments).set({ amount: '99.00' })
          .where(eq(invoicePayments.invoiceId, invoiceId));
      } catch {
        paymentUpdateRejected = true;
      }
      try {
        await transaction.delete(invoicePayments)
          .where(eq(invoicePayments.invoiceId, invoiceId));
      } catch {
        paymentDeleteRejected = true;
      }

      let invoiceUpdateRejected = false;
      let invoiceReopenRejected = false;
      let invoiceDeleteRejected = false;
      let lineInsertRejected = false;
      let lineUpdateRejected = false;
      let lineDeleteRejected = false;
      try {
        await transaction.update(invoices).set({ authorizedBySnapshot: `${marker}-changed` })
          .where(eq(invoices.id, invoiceId));
      } catch {
        invoiceUpdateRejected = true;
      }
      try {
        await transaction.update(invoices).set({ status: 'draft' })
          .where(eq(invoices.id, invoiceId));
      } catch {
        invoiceReopenRejected = true;
      }
      try {
        await transaction.insert(invoiceLines).values({
          invoiceId,
          branchId,
          lineNumber: 2,
          itemType: 'service',
          serviceId,
          itemNameSnapshot: marker,
          quantity: 1,
          unitPrice: '0.04',
          lineTotal: '0.04',
          commissionRuleSnapshot: 'service_default',
          commissionRateSnapshot: '33.33',
          commissionAmountSnapshot: '0.01',
        });
      } catch {
        lineInsertRejected = true;
      }
      try {
        await transaction.update(invoiceLines).set({ itemNameSnapshot: `${marker}-changed` })
          .where(eq(invoiceLines.id, lineId));
      } catch {
        lineUpdateRejected = true;
      }
      try {
        await transaction.delete(invoiceLines).where(eq(invoiceLines.id, lineId));
      } catch {
        lineDeleteRejected = true;
      }
      try {
        await transaction.delete(invoices).where(eq(invoices.id, invoiceId));
      } catch {
        invoiceDeleteRejected = true;
      }

      let unlinkedReversalRejected = false;
      try {
        await transaction.insert(commissionLedgerEntries).values({
          invoiceId,
          invoiceLineId: lineId,
          employeeId,
          actingAccountId: accountId,
          entryType: 'reversal',
          reversesEntryId: ledgerId,
          commissionRuleSnapshot: 'service_default',
          commissionRateSnapshot: '33.33',
          baseAmount: '0.02',
          amount: '-0.01',
          createdAt: now,
        });
      } catch {
        unlinkedReversalRejected = true;
      }

      let updateRejected = false;
      let deleteRejected = false;
      try {
        await transaction.update(commissionLedgerEntries).set({ amount: '9.00' })
          .where(eq(commissionLedgerEntries.id, ledgerId));
      } catch {
        updateRejected = true;
      }
      try {
        await transaction.delete(commissionLedgerEntries)
          .where(eq(commissionLedgerEntries.id, ledgerId));
      } catch {
        deleteRejected = true;
      }
      throw new Error(`rollback:${invalidStatusRejected}:${emptyCompletionRejected}:${unpaidCompletionRejected}:${lineSubtotalMismatchRejected}:${missingCommissionRejected}:${paymentInsertRejected}:${paymentUpdateRejected}:${paymentDeleteRejected}:${invoiceUpdateRejected}:${invoiceReopenRejected}:${invoiceDeleteRejected}:${lineInsertRejected}:${lineUpdateRejected}:${lineDeleteRejected}:${unlinkedReversalRejected}:${updateRejected}:${deleteRejected}`);
    })).rejects.toThrow(`rollback:${Array.from({ length: 17 }, () => 'true').join(':')}`);
  });
});

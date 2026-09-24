import {
  accounts,
  erpProductStocks,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { closeMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const { database, fixture, operation } = createSaleRepositoryMysqlFixtures();
beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const at = new Date('2026-08-03T11:35:00.000Z');
  await database.insert(accounts).values({
    username: 'erp9-isolated-admin',
    passwordHash: 'unused',
    role: 'admin',
    createdAt: at,
    updatedAt: at,
  });
}, 120_000);

afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
}, 30_000);

describe('ERP sale repository MySQL integration', () => {
  it('settles concurrent identical idempotent writes as one stored invoice', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    const results = await Promise.all([
      repository.complete(request),
      repository.complete({ ...request, invoiceNumber: `${request.invoiceNumber}-unused` }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await database.select().from(invoices)
      .where(eq(invoices.idempotencyKey, request.input.idempotencyKey))).toHaveLength(1);
  });

  it('rejects a multi-row payment insert whose combined amount exceeds the balance', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '10.00' }];
    const invoice = await repository.complete(request);

    await expect(database.execute(sql`
      INSERT INTO ${invoicePayments}
        (invoice_id, method, amount, operation_reference, is_initial,
         cashier_session_id, acting_account_id, paid_at, created_at)
      VALUES
        (${invoice.id}, 'visa', 25.00, ${crypto.randomUUID()}, false,
         ${data.cashierSessionId}, ${data.accountId}, ${data.at}, ${data.at}),
        (${invoice.id}, 'instapay', 25.00, ${crypto.randomUUID()}, false,
         ${data.cashierSessionId}, ${data.accountId}, ${data.at}, ${data.at})
    `)).rejects.toBeDefined();
    expect(await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoice.id))).toHaveLength(1);
  });

  it('completes a concurrent counter burst without losing or duplicating service sales', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const requests = Array.from({ length: 10 }, (_, index) => ({
      ...operation(data, crypto.randomUUID()),
      invoiceNumber: `INV-2026.08.03-14.40-${data.branchId * 100 + index + 1}`,
    }));
    const results = await Promise.all(requests.map((request) => repository.complete(request)));
    expect(new Set(results.map(({ id }) => id)).size).toBe(10);
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(10);
  });

  it('maps an invoice-number collision without a matching idempotency key to a conflict', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const first = operation(data, crypto.randomUUID());
    await repository.complete(first);

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('maps a sellerless legacy idempotency row to a deterministic conflict', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const stored = (await database.select().from(invoices)
      .where(eq(invoices.id, completed.id)).limit(1))[0]!;
    const legacyKey = crypto.randomUUID();
    await database.insert(invoices).values({
      ...stored,
      id: undefined,
      status: 'draft',
      invoiceNumber: `${stored.invoiceNumber}-LEGACY`,
      idempotencyKey: legacyKey,
      sellerEmployeeId: null,
      sellerNameSnapshot: null,
    });
    await expect(repository.findByIdempotencyKey(legacyKey, {
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it.each([
    ['invoice', 'BEFORE INSERT', 'erp_invoices'],
    ['line', 'BEFORE INSERT', 'erp_invoice_lines'],
    ['commission', 'BEFORE INSERT', 'erp_commission_ledger_entries'],
    ['payment', 'BEFORE INSERT', 'erp_invoice_payments'],
    ['completion', 'BEFORE UPDATE', 'erp_invoices'],
    ['audit', 'BEFORE INSERT', 'audit_events'],
  ] as const)('rolls back the complete aggregate when %s persistence fails', async (
    phase,
    timing,
    table,
  ) => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const trigger = `erp12_fail_${phase}`;
    await database.execute(sql.raw(
      `CREATE TRIGGER \`${trigger}\` ${timing} ON \`${table}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced ERP 12 rollback'`,
    ));
    try {
      await expect(repository.complete(operation(data, crypto.randomUUID()))).rejects.toBeDefined();
      expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
        .toHaveLength(0);
    } finally {
      await database.execute(sql.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``));
    }
  });

  it('rolls back product stock when stock-movement persistence fails', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    delete request.input.discount; delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '50.00' }];
    await database.execute(sql.raw("CREATE TRIGGER `erp13_fail_movement` BEFORE INSERT ON `erp_stock_movements` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced ERP 13 rollback'"));
    try {
      await expect(repository.complete(request)).rejects.toBeDefined();
      expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(2);
      expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId))).toHaveLength(0);
    } finally {
      await database.execute(sql.raw('DROP TRIGGER IF EXISTS `erp13_fail_movement`'));
    }
  });
});

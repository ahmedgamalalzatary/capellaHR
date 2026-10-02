import { accounts, erpStockBatches, erpStockBatchBalances } from '@capella/database/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { prepareMysqlIntegrationDatabase, closeMysqlIntegrationDatabase } from '../mysql-integration-database.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const { database, fixture, operation } = createSaleRepositoryMysqlFixtures();
beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const at = new Date('2026-08-03T11:35:00Z');
  await database.insert(accounts).values({ username: 'batch-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at });
}, 180_000);
afterAll(() => closeMysqlIntegrationDatabase(database), 30_000);

describe('invoice batch allocation and returns', () => {
  it('reserves a manual batch choice before allocating automatic sibling lines', async () => {
    const data = await fixture();
    const batchIds: number[] = [];
    for (const expiryDate of ['2027-01-01', '2027-02-01']) {
      const batchId = Number((await database.insert(erpStockBatches).values({ originProductId: data.productId, originBranchId: data.branchId, expiryDate, createdAt: data.at, updatedAt: data.at }))[0].insertId);
      batchIds.push(batchId);
      await database.insert(erpStockBatchBalances).values({ batchId, productId: data.productId, branchId: data.branchId, quantity: 1, updatedAt: data.at });
    }
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [
      { itemType: 'product', productId: data.productId, employeeId: data.employeeId, quantity: 1 },
      { itemType: 'product', productId: data.productId, employeeId: data.employeeId, quantity: 1, batches: [{ batchId: batchIds[0]!, quantity: '1.000' }] },
    ];
    sale.input.discount = undefined; sale.input.tax = undefined; sale.input.payments = [{ method: 'cash', amount: '100.00' }];
    await expect(repository.complete(sale)).resolves.toMatchObject({ lines: [
      { batches: [{ batchId: batchIds[1], quantity: '1.000' }] },
      { batches: [{ batchId: batchIds[0], quantity: '1.000' }] },
    ] });
  });
  it('snapshots the batches sold and requires selection on a partial multi-batch return', async () => {
    const data = await fixture();
    for (const expiryDate of ['2027-01-01', '2026-01-01']) {
      const batchId = Number((await database.insert(erpStockBatches).values({ originProductId: data.productId, originBranchId: data.branchId, expiryDate, createdAt: data.at, updatedAt: data.at }))[0].insertId);
      await database.insert(erpStockBatchBalances).values({ batchId, productId: data.productId, branchId: data.branchId, quantity: 1, updatedAt: data.at });
    }
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, employeeId: data.employeeId, quantity: 2 }];
    sale.input.discount = undefined; sale.input.tax = undefined; sale.input.payments = [{ method: 'cash', amount: '100.00' }];
    const invoice = await repository.complete(sale);
    expect(invoice.lines[0]).toMatchObject({ batches: [
      { expiryDate: '2026-01-01', quantity: '1.000' }, { expiryDate: '2027-01-01', quantity: '1.000' },
    ] });
    const reversal = { type: 'refund' as const, invoiceId: invoice.id, input: { branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Partial return',
      lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }], payments: [{ method: 'cash' as const, amount: '50.00' }],
    }, actingAccountId: data.accountId, actingAccountRole: 'cashier' as const, reversedAt: data.at };
    await expect(repository.reverse(reversal)).rejects.toMatchObject({ code: 'BATCH_SELECTION_INVALID' });
    const selected = { ...reversal, input: { ...reversal.input, lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1,
      batches: [{ batchId: invoice.lines[0]!.batches![1]!.batchId, quantity: '1.000' }],
    }] } };
    const returned = await repository.reverse(selected);
    expect(returned.lines[0]!.batches).toEqual([
      expect.objectContaining({ expiryDate: '2026-01-01', refundableQuantity: '1.000' }),
      expect.objectContaining({ expiryDate: '2027-01-01', refundableQuantity: '0.000' }),
    ]);
    expect(await repository.reverse(selected)).toEqual(returned);
  });
});

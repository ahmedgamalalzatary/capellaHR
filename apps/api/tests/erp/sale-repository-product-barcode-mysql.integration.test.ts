import {
  accounts,
} from '@capella/database/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleProductStockRepository } from '../../src/modules/erp/stock/index.js';
import { closeMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const { database, fixture } = createSaleRepositoryMysqlFixtures();
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
  it('lets a branch hold one product per barcode and many with none, and finds them by code', async () => {
    const data = await fixture();
    const repository = createDrizzleProductStockRepository(database, createErpAuditCapability(), () => data.at);
    const write = (suffix: string, barcode: string | null) => ({
      branchId: data.branchId, name: `Coded ${suffix} ${data.marker}`,
      nameNormalized: `coded-${suffix}-${data.marker}`, description: null,
      sellingPrice: '10.00', lastPurchaseCost: '0.00', lowStockThreshold: 0,
      barcode, isActive: true, openingQuantity: 0,
    });

    // Thirteen digits, unique to this run, so a rerun cannot clash with itself.
    const code = `2${String(process.pid).slice(-6).padStart(6, '0')}${String(Date.now()).slice(-6)}`;
    const coded = await repository.create(write('a', code), data.adminAccountId);
    expect(await repository.findByBarcode(data.branchId, coded.barcode!))
      .toMatchObject({ id: coded.id });

    // A duplicate code in the same branch is refused by the index itself.
    await expect(repository.create(write('b', coded.barcode), data.adminAccountId)).rejects.toBeDefined();

    // "No barcode yet" is the normal state and must never be a uniqueness clash.
    await repository.create(write('c', null), data.adminAccountId);
    await expect(repository.create(write('d', null), data.adminAccountId)).resolves.toBeDefined();
  });

  it('refuses a code the scanner could never have read', async () => {
    const data = await fixture();
    const repository = createDrizzleProductStockRepository(database, createErpAuditCapability(), () => data.at);
    await expect(repository.create({
      branchId: data.branchId, name: `Bad ${data.marker}`, nameNormalized: `bad-${data.marker}`,
      description: null, sellingPrice: '10.00', lastPurchaseCost: '0.00', lowStockThreshold: 0,
      barcode: 'ab', isActive: true, openingQuantity: 0,
    }, data.adminAccountId)).rejects.toBeDefined();
  });
});

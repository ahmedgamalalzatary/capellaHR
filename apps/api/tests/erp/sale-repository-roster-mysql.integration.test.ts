import {
  accounts,
  auditEvents,
  employees,
  invoices,
} from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleBranchCashierRosterRepository } from '../../src/modules/erp/sales/branch-cashier-roster-repository.js';
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
  it('audits inactive roster rows before replacing the full branch roster', async () => {
    const data = await fixture();
    await database.update(employees).set({ employmentStatus: 'inactive' })
      .where(eq(employees.id, data.sellerEmployeeId));
    const repository = createDrizzleBranchCashierRosterRepository(
      database,
      createErpAuditCapability(),
    );

    await repository.replace({
      branchId: data.branchId,
      employeeIds: [],
      replacedAt: data.at,
    });

    const event = (await database.select().from(auditEvents).where(and(
      eq(auditEvents.module, 'erp_cashier_roster'),
      eq(auditEvents.entityId, String(data.branchId)),
    )).orderBy(sql`${auditEvents.id} desc`).limit(1))[0];
    expect(event?.beforeState).toEqual({ members: [data.sellerEmployeeId] });
  });

  it('rejects removing the seller from a completed invoice', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    await expect(database.update(invoices).set({
      sellerEmployeeId: null,
      sellerNameSnapshot: null,
    }).where(eq(invoices.id, completed.id))).rejects.toThrow();
  });

  it('rejects a seller who is not on the branch roster', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const outside = operation(data, crypto.randomUUID());
    outside.input = { ...outside.input, sellerEmployeeId: data.employeeId };

    await expect(repository.complete(outside)).rejects.toMatchObject({
      code: 'SELLER_NOT_ON_ROSTER',
    });
  });
});

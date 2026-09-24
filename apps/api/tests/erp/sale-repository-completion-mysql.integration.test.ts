import {
  accounts,
  auditEvents,
  commissionLedgerEntries,
  employees,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { ErpAssignmentError } from '../../src/modules/erp/assignment/index.js';
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
  it('credits each unit of the same service to its own employee with that employee\'s rate', async () => {
    const data = await fixture();
    // A second performing employee on the default 10% rate (the first has a 15% override).
    const secondEmployeeId = Number((await database.insert(employees).values({
      employeeCode: data.employeeCode + 7,
      fullName: `Second ${data.marker}`,
      personalPhone: `015${data.clientPhone.slice(3)}`,
      whatsappPhone: `015${data.clientPhone.slice(3)}`,
      pinHash: 'unused',
      age: 30,
      address: 'Cairo',
      branchId: data.branchId,
      shiftDurationMinutes: 480,
      monthlyBaseSalary: '5000.00',
      createdAt: data.at,
      updatedAt: data.at,
    }))[0].insertId);
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    // The same service twice on one invoice, each unit performed by someone else.
    request.input.lines = [
      { itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00', employeeId: data.employeeId },
      { itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00', employeeId: secondEmployeeId },
    ];
    request.input.discount = undefined;
    request.input.tax = undefined;
    request.input.payments = [{ method: 'cash', amount: '400.00' }];
    request.assertEmployees = async () => [
      { id: data.employeeId, employeeCode: data.employeeCode, fullName: `Employee ${data.marker}`, branchId: data.branchId },
      { id: secondEmployeeId, employeeCode: data.employeeCode + 7, fullName: `Second ${data.marker}`, branchId: data.branchId },
    ];

    const result = await repository.complete(request);

    // Two independent line rows, each carrying its own performer and rate.
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((line) => ({
      employeeId: line.employee?.id,
      commissionRate: line.commissionRate,
      commissionAmount: line.commissionAmount,
    }))).toEqual([
      { employeeId: data.employeeId, commissionRate: '15.00', commissionAmount: '30.00' },
      { employeeId: secondEmployeeId, commissionRate: '10.00', commissionAmount: '20.00' },
    ]);

    // Two queue tickets, one per unit, each bound to its own line.
    expect(result.lines.map((line) => line.queueNumbers)).toEqual([[expect.any(Number)], [expect.any(Number)]]);

    // Each employee earns exactly their own unit's commission.
    const ledger = await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, result.id));
    const byEmployee = new Map(ledger.map((entry) => [entry.employeeId, entry.amount]));
    expect(ledger).toHaveLength(2);
    expect(byEmployee.get(data.employeeId)).toBe('30.00');
    expect(byEmployee.get(secondEmployeeId)).toBe('20.00');
    expect(ledger.every((entry) => entry.entryType === 'earned')).toBe(true);
  });

  it('writes a complete service sale with snapshots, override commission, payment, and audit', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const idempotencyKey = crypto.randomUUID();
    const result = await repository.complete(operation(data, idempotencyKey));

    expect(result).toMatchObject({
      status: 'completed',
      client: { id: data.clientId },
      totals: { subtotal: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
      lines: [{
        sourceId: data.serviceId,
        employee: { id: data.employeeId, employeeCode: data.employeeCode },
        commissionRule: 'employee_override',
        commissionRate: '15.00',
        commissionAmount: '30.00',
      }],
      payments: [{ method: 'cash', amount: '185.00' }],
    });
    expect(await database.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, result.id)))
      .toHaveLength(1);
    expect(await database.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, result.id)))
      .toHaveLength(1);
    expect(await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, result.id))).toHaveLength(1);
    expect(await database.select().from(auditEvents).where(eq(auditEvents.module, 'erp-sales')))
      .toEqual(expect.arrayContaining([expect.objectContaining({ action: 'complete' })]));

    await database.insert(invoices).values({
      branchId: data.branchId,
      clientId: data.clientId,
      actingAccountId: data.accountId,
      cashierSessionId: data.cashierSessionId,
      invoiceNumber: `INV-2026.08.03-14.36-${data.branchId}`,
      idempotencyKey: crypto.randomUUID(),
      clientNameSnapshot: `Client ${data.marker}`,
      clientPhoneSnapshot: data.clientPhone,
      authorizedBySnapshot: data.marker,
      subtotal: '1.00',
      total: '1.00',
      soldAt: data.at,
      createdAt: data.at,
    });
    const visits = await repository.listClientVisits(data.branchId, data.clientId, {
      page: 1,
      pageSize: 20,
    });
    expect(visits).toMatchObject({ total: 1, items: [{ id: result.id }] });

    const anotherCashier = await fixture();
    await expect(repository.findByIdempotencyKey(idempotencyKey, {
      actingAccountId: anotherCashier.accountId,
      actingAccountRole: 'cashier',
    })).resolves.toBeNull();
  });

  it('pays each service line its own employee, at that employee\'s own rate', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    // The first employee holds a 15% override on this service; the second holds
    // none and so earns the service default of 10%.
    request.input.lines = [
      {
        itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00',
        employeeId: data.employeeId,
      },
      {
        itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00',
        employeeId: data.sellerEmployeeId,
      },
    ];
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '400.00' }];
    request.assertEmployees = async () => [
      {
        id: data.employeeId, employeeCode: data.employeeCode,
        fullName: `Employee ${data.marker}`, branchId: data.branchId,
      },
      {
        id: data.sellerEmployeeId, employeeCode: data.employeeCode + 1,
        fullName: `Seller ${data.marker}`, branchId: data.branchId,
      },
    ];

    const completed = await repository.complete(request);

    expect(completed.lines).toMatchObject([
      {
        employee: { id: data.employeeId, name: `Employee ${data.marker}` },
        commissionRule: 'employee_override', commissionRate: '15.00', commissionAmount: '30.00',
      },
      {
        employee: { id: data.sellerEmployeeId, name: `Seller ${data.marker}` },
        commissionRule: 'service_default', commissionRate: '10.00', commissionAmount: '20.00',
      },
    ]);
    const ledger = await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, completed.id));
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, amount: '30.00' }),
      expect.objectContaining({ employeeId: data.sellerEmployeeId, amount: '20.00' }),
    ]));
    await expect(repository.listInvoices(data.branchId, { page: 1, pageSize: 20, orderBy: 'soldAt', orderDir: 'desc' }))
      .resolves.toMatchObject({
        items: [{
          id: completed.id,
          employees: [{ id: data.employeeId }, { id: data.sellerEmployeeId }],
        }],
      });

    // Refunding only the second line takes commission back from that employee alone.
    await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'الخدمة الثانية فقط',
        lines: [{ invoiceLineId: completed.lines[1]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '200.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: data.at,
    });

    expect(await database.select().from(commissionLedgerEntries).where(and(
      eq(commissionLedgerEntries.invoiceId, completed.id),
      eq(commissionLedgerEntries.entryType, 'reversal'),
    ))).toEqual([
      expect.objectContaining({ employeeId: data.sellerEmployeeId, amount: '-20.00' }),
    ]);
  });

  it('rejects a submitted price that differs from a fixed service price', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{
      itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '175.00',
      employeeId: data.employeeId,
    }];

    await expect(repository.complete(request)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });

  it('uses an open service sale price for totals, invoice snapshots, and commission', async () => {
    const data = await fixture();
    await database.update(erpServices).set({ price: null }).where(eq(erpServices.id, data.serviceId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{
      itemType: 'service', serviceId: data.serviceId, quantity: 2, unitPrice: '800.00',
      employeeId: data.employeeId,
    }];
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '1600.00' }];

    const completed = await repository.complete(request);

    expect(completed).toMatchObject({
      totals: { subtotal: '1600.00', total: '1600.00' },
      lines: [{ unitPrice: '800.00', lineTotal: '1600.00', commissionAmount: '240.00' }],
    });
  });

  it('rolls back the aggregate when attendance revalidation fails', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.assertEmployees = () => Promise.reject(
      new ErpAssignmentError('ERP_EMPLOYEE_NOT_PRESENT', 'not present'),
    );
    await expect(repository.complete(request)).rejects.toBeInstanceOf(ErpAssignmentError);
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });
});

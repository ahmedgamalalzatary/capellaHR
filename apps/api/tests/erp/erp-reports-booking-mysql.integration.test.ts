import { accounts, erpCategories, erpServices } from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleBookingRepository } from '../../src/modules/erp/bookings/booking-repository.js';
import { createErpReportsModule } from '../../src/modules/erp/erp-reports/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createSaleService } from '../../src/modules/erp/sales/sale-service.js';
import { closeMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const { database, fixture } = createSaleRepositoryMysqlFixtures();

let data: Awaited<ReturnType<typeof fixture>>;
let bookingId: number;
let invoiceId: number;
let invoiceNumber: string;

// One booking walked through its whole money life on one day:
// 300.00 cash + 50.00 visa up front for A (200.00) and C (150.00); A sold
// using 200.00 of it; C cancelled and its 150.00 handed back as 100.00 cash
// + 50.00 instapay.
beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  // The shared fixture borrows an existing admin account.
  const adminAt = new Date('2026-08-03T11:35:00.000Z');
  await database.insert(accounts).values({
    username: 'erp-booking-report-admin', passwordHash: 'unused', role: 'admin',
    createdAt: adminAt, updatedAt: adminAt,
  });
  data = await fixture();
  const audit = createErpAuditCapability();
  const bookings = createDrizzleBookingRepository(database, audit);
  const leftoverServiceId = Number((await database.insert(erpServices).values({
    branchId: data.branchId,
    categoryId: (await database.select().from(erpCategories)
      .where(eq(erpCategories.branchId, data.branchId)))[0]!.id,
    name: `Leftover ${data.marker}`, nameNormalized: `leftover-${data.marker}`, price: '150.00',
    commissionPercent: '10.00', createdAt: data.at, updatedAt: data.at,
  }))[0].insertId);
  const booking = await bookings.create({
    branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
    scheduledAt: data.at, note: null,
    services: [{ serviceId: data.serviceId }, { serviceId: leftoverServiceId }],
    createdAt: data.at,
  });
  bookingId = booking.id;
  await bookings.transition(data.branchId, bookingId, ['booked'], 'arrived', data.at);
  for (const [method, amount] of [['cash', '300.00'], ['visa', '50.00']] as const) {
    await bookings.recordPayment({
      bookingId, branchId: data.branchId, cashierSessionId: data.cashierSessionId,
      actorAccountId: data.accountId, actorRole: 'cashier',
      method, amount, operationReference: crypto.randomUUID(), at: data.at,
    });
  }
  invoiceNumber = `INV-BOOKING-REPORT-${data.marker}`.slice(0, 40);
  const sales = createSaleService({
    employees: { findActiveById: async () => null },
    repository: createDrizzleSaleRepository(database, audit),
    resolveBranchContext: async () => ({
      accountId: data.accountId, accountRole: 'cashier' as const,
      branchId: data.branchId, employeeId: null,
    }),
    assignment: {
      assertAssignable: async () => ({
        id: data.employeeId, employeeCode: data.employeeCode,
        fullName: `Employee ${data.marker}`, branchId: data.branchId,
      }),
    },
    invoiceNumbers: {
      allocate: async () => ({ invoiceNumber, allocatedAt: new Date(data.at.getTime() + 1) }),
    },
    bookings: { applySale: bookings.applySale.bind(bookings) },
  });
  invoiceId = (await sales.complete(
    { role: 'cashier', accountId: data.accountId, branchId: data.branchId },
    {
      branchId: data.branchId, clientId: data.clientId, cashierSessionId: data.cashierSessionId,
      bookingId, bookingCredit: '200.00', idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service', serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [],
    },
  )).id;
  await bookings.cancelServices({
    bookingId, branchId: data.branchId, actorAccountId: data.accountId, actorRole: 'cashier',
    serviceIds: [leftoverServiceId],
    refund: {
      cashierSessionId: data.cashierSessionId,
      operationReference: crypto.randomUUID(),
      payments: [{ method: 'cash', amount: '100.00' }, { method: 'instapay', amount: '50.00' }],
    },
    at: new Date(data.at.getTime() + 2),
  });
}, 120_000);

afterAll(async () => { await closeMysqlIntegrationDatabase(database); }, 30_000);

const read = (
  reportType: 'erp-payment-methods' | 'erp-bookings' | 'erp-invoice',
  selection: { mode: 'all' } | { mode: 'selected'; ids: number[] } = { mode: 'all' },
) => createErpReportsModule(database).reader.read(
  reportType,
  { branchId: data.branchId, dateFrom: '2026-08-03', dateTo: '2026-08-03' },
  selection, { page: 1, pageSize: 50 }, data.at,
);

describe('ERP booking money in reports MySQL integration', () => {
  it('counts up-front payments and refunds by method, never the credit used at checkout', async () => {
    const result = await read('erp-payment-methods');

    expect(result).toMatchObject({ kind: 'success', total: 4 });
    if (result.kind !== 'success') return;
    const rows = result.snapshot.rows.map(({ eventType, paymentMethod, amount }) => ({
      eventType, paymentMethod, amount,
    }));
    expect(rows).toEqual(expect.arrayContaining([
      { eventType: 'دفع مقدم حجز', paymentMethod: 'نقدي', amount: '300.00' },
      { eventType: 'دفع مقدم حجز', paymentMethod: 'فيزا', amount: '50.00' },
      { eventType: 'رد مقدم حجز', paymentMethod: 'نقدي', amount: '-100.00' },
      { eventType: 'رد مقدم حجز', paymentMethod: 'إنستا باي', amount: '-50.00' },
    ]));
    expect(new Set(result.snapshot.rows.map(({ id }) => id)).size).toBe(4);
    expect(result.snapshot.summary).toMatchObject({
      totalRecords: 4,
      totalNetCashPayments: '200.00',
      totalNetVisaPayments: '50.00',
      totalNetInstapayPayments: '-50.00',
      totalNetVodafoneCashPayments: '0.00',
    });
  });

  it('lists the booking with its services, ledger money, and invoice numbers', async () => {
    const result = await read('erp-bookings');

    expect(result).toMatchObject({
      kind: 'success',
      total: 1,
      snapshot: {
        rows: [expect.objectContaining({
          id: bookingId, status: 'تم البيع', clientName: `Client ${data.marker}`,
          servicesTotal: 2, servicesSold: 1, servicesCancelled: 1, servicesPending: 0,
          paid: '350.00', applied: '200.00', refunded: '150.00', held: '0.00',
          invoiceNumbers: invoiceNumber,
        })],
        summary: expect.objectContaining({
          totalRecords: 1, totalPaid: '350.00', totalApplied: '200.00',
          totalRefunded: '150.00', totalHeld: '0.00',
        }),
      },
    });
  });

  it('labels the up-front credit on the invoice snapshot', async () => {
    const result = await read('erp-invoice', { mode: 'selected', ids: [invoiceId] });

    expect(result).toMatchObject({
      kind: 'success',
      snapshot: { summary: expect.objectContaining({ payments: 'مدفوع من المقدم: 200.00' }) },
    });
  });
});

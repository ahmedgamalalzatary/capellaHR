import { accounts, cashierSessions, erpBookingServices, erpBookings, erpCategories, erpServices, invoicePayments, invoiceReversalPayments } from '@capella/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

import { createDrizzleBookingRepository } from '../../src/modules/erp/bookings/booking-repository.js';
import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createSaleService } from '../../src/modules/erp/sales/sale-service.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const { database, fixture } = createSaleRepositoryMysqlFixtures();
let invoiceSequence = 0;

const buildSaleService = (data: Awaited<ReturnType<typeof fixture>>, options: { soldToday?: boolean } = {}) => {
  const audit = createErpAuditCapability();
  const bookingRepository = createDrizzleBookingRepository(database, audit);
  const saleRepository = createDrizzleSaleRepository(database, audit);
  let counter = 0;
  const service = createSaleService({
    repository: saleRepository,
    resolveBranchContext: async () => ({
      accountId: data.accountId, accountRole: 'cashier' as const,
      branchId: data.branchId, employeeId: null,
    }),
    assignment: {
      assertAssignable: async () => ({
        id: data.employeeId,
        employeeCode: data.employeeCode,
        fullName: `Employee ${data.marker}`,
        branchId: data.branchId,
      }),
    },
    invoiceNumbers: {
      allocate: async () => {
        counter += 1;
        invoiceSequence += 1;
        return {
          invoiceNumber: `INV-2026.08.03-14.35-${invoiceSequence}`,
          allocatedAt: options.soldToday ? new Date() : new Date(data.at.getTime() + counter),
        };
      },
    },
    bookings: { applySale: bookingRepository.applySale.bind(bookingRepository) },
  });
  return { service, bookingRepository, saleRepository };
};

const bookingOf = async (bookingId: number) => (await database.select()
  .from(erpBookings).where(eq(erpBookings.id, bookingId)))[0]!;
const servicesOf = async (bookingId: number) => (await database.select()
  .from(erpBookingServices).where(eq(erpBookingServices.bookingId, bookingId)));

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const at = new Date('2026-08-03T11:35:00.000Z');
  await database.insert(accounts).values({
    username: 'erp9-booking-credit-admin', passwordHash: 'unused', role: 'admin',
    createdAt: at, updatedAt: at,
  });
}, 120_000);

afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
}, 30_000);

describe('ERP sale with booking credit MySQL integration', () => {
  it('applies held up-front money first, marks sold services, and keeps the rest pending', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const secondServiceId = Number((await database.insert(erpServices).values({
      branchId: data.branchId,
      categoryId: (await database.select().from(erpCategories).where(eq(erpCategories.branchId, data.branchId)))[0]!.id,
      name: `Leftover ${data.marker}`, nameNormalized: `leftover-${data.marker}`, price: '150.00',
      commissionPercent: '10.00', createdAt: data.at, updatedAt: data.at,
    }))[0].insertId);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null,
      services: [{ serviceId: data.serviceId }, { serviceId: secondServiceId }],
      createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    await bookingRepository.recordPayment({
      bookingId: booking.id, branchId: data.branchId, cashierSessionId: data.cashierSessionId,
      actorAccountId: data.accountId, actorRole: 'cashier',
      method: 'cash', amount: '100.00', operationReference: crypto.randomUUID(), at: data.at,
    });

    const invoice = await service.complete({ role: 'cashier', accountId: data.accountId, branchId: data.branchId }, {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      bookingCredit: '100.00',
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service', serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash', amount: '100.00' }],
    });

    expect(invoice.totals.amountPaid).toBe('200.00');
    const credits = await database.select().from(invoicePayments).where(and(
      eq(invoicePayments.invoiceId, invoice.id), eq(invoicePayments.method, 'booking_credit'),
    ));
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amount).toBe('100.00');
    expect(credits[0]!.bookingId).toBe(booking.id);
    expect(credits[0]!.isInitial).toBe(true);

    const stored = await bookingOf(booking.id);
    expect(stored.status).toBe('arrived');
    const lines = await servicesOf(booking.id);
    const sold = lines.find((line) => line.serviceId === data.serviceId)!;
    expect(sold.status).toBe('sold');
    expect(sold.invoiceId).toBe(invoice.id);
    expect(sold.invoiceLineId).toBe(invoice.lines[0]!.id);
    expect(lines.find((line) => line.serviceId === secondServiceId)!.status).toBe('pending');
    const hydrated = await bookingRepository.findById(data.branchId, booking.id);
    expect(hydrated!.money).toMatchObject({ paid: '100.00', applied: '100.00', held: '0.00' });
  });

  it('rejects a credit that does not equal min(held, invoice total)', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    await bookingRepository.recordPayment({
      bookingId: booking.id, branchId: data.branchId, cashierSessionId: data.cashierSessionId,
      actorAccountId: data.accountId, actorRole: 'cashier',
      method: 'cash', amount: '100.00', operationReference: crypto.randomUUID(), at: data.at,
    });
    await expect(service.complete({ role: 'cashier', accountId: data.accountId, branchId: data.branchId }, {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      bookingCredit: '50.00',
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service', serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash', amount: '150.00' }],
    })).rejects.toMatchObject({ code: 'BOOKING_CREDIT_MISMATCH' });
  });

  it('requires payments plus credit to cover a service invoice in full', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    await bookingRepository.recordPayment({
      bookingId: booking.id, branchId: data.branchId, cashierSessionId: data.cashierSessionId,
      actorAccountId: data.accountId, actorRole: 'cashier',
      method: 'cash', amount: '100.00', operationReference: crypto.randomUUID(), at: data.at,
    });
    await expect(service.complete({ role: 'cashier', accountId: data.accountId, branchId: data.branchId }, {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      bookingCredit: '100.00',
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service', serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash', amount: '50.00' }],
    })).rejects.toMatchObject({ code: 'PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES' });
  });

  it('rejects selling unbooked services, duplicates, and quantities above one', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const unbookedServiceId = Number((await database.insert(erpServices).values({
      branchId: data.branchId,
      categoryId: (await database.select().from(erpCategories).where(eq(erpCategories.branchId, data.branchId)))[0]!.id,
      name: `Unbooked ${data.marker}`, nameNormalized: `unbooked-${data.marker}`, price: '80.00',
      commissionPercent: '10.00', createdAt: data.at, updatedAt: data.at,
    }))[0].insertId);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    const base = {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(service.complete({ role: 'cashier', accountId: data.accountId, branchId: data.branchId }, {
      ...base,
      lines: [
        { itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00', employeeId: data.employeeId },
        { itemType: 'service', serviceId: unbookedServiceId, quantity: 1, unitPrice: '80.00', employeeId: data.employeeId },
      ],
      payments: [{ method: 'cash', amount: '280.00' }],
    })).rejects.toMatchObject({ code: 'BOOKING_SERVICE_NOT_FOUND' });
    await expect(service.complete({ role: 'cashier', accountId: data.accountId, branchId: data.branchId }, {
      ...base,
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service', serviceId: data.serviceId, quantity: 2,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash', amount: '400.00' }],
    })).rejects.toMatchObject({ code: 'BOOKING_SERVICE_NOT_FOUND' });
  });

  it('marks the booking converted when the sale leaves no pending services', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    await service.complete({ role: 'cashier', accountId: data.accountId, branchId: data.branchId }, {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service', serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash', amount: '200.00' }],
    });
    expect((await bookingOf(booking.id)).status).toBe('converted');
  });

  it('replays an idempotent booking sale with its credit without a conflict', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    await bookingRepository.recordPayment({
      bookingId: booking.id, branchId: data.branchId, cashierSessionId: data.cashierSessionId,
      actorAccountId: data.accountId, actorRole: 'cashier',
      method: 'cash', amount: '100.00', operationReference: crypto.randomUUID(), at: data.at,
    });
    const actor = { role: 'cashier' as const, accountId: data.accountId, branchId: data.branchId };
    const input = {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      bookingCredit: '100.00',
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service' as const, serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash' as const, amount: '100.00' }],
    };
    const first = await service.complete(actor, input);
    const second = await service.complete(actor, input);
    expect(second.id).toBe(first.id);
    const credits = await database.select().from(invoicePayments).where(and(
      eq(invoicePayments.invoiceId, first.id), eq(invoicePayments.method, 'booking_credit'),
    ));
    expect(credits).toHaveLength(1);
  });

  it('lets exactly one concurrent sale consume the booking', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    const actor = { role: 'cashier' as const, accountId: data.accountId, branchId: data.branchId };
    const results = await Promise.allSettled([0, 1].map(() => service.complete(actor, {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service' as const, serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash' as const, amount: '200.00' }],
    })));
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((await bookingOf(booking.id)).status).toBe('converted');
  });

  it('returns the original invoice when the same booking sale races itself', async () => {
    const data = await fixture();
    const { service, bookingRepository } = buildSaleService(data);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    await bookingRepository.recordPayment({
      bookingId: booking.id, branchId: data.branchId, cashierSessionId: data.cashierSessionId,
      actorAccountId: data.accountId, actorRole: 'cashier',
      method: 'cash', amount: '100.00', operationReference: crypto.randomUUID(), at: data.at,
    });
    const actor = { role: 'cashier' as const, accountId: data.accountId, branchId: data.branchId };
    const input = {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: data.cashierSessionId,
      bookingId: booking.id,
      bookingCredit: '100.00',
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service' as const, serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash' as const, amount: '100.00' }],
    };
    // Offline sync plus a manual retry of the same request at the same moment.
    const results = await Promise.all([service.complete(actor, input), service.complete(actor, input)]);
    expect(results[0].id).toBe(results[1].id);
  });

  it('hands a voided booking invoice back on the methods the cashier chose', async () => {
    const data = await fixture();
    const { service, bookingRepository, saleRepository } = buildSaleService(data, { soldToday: true });
    // A void is only valid on the sale's own Cairo day, so the sale runs in a
    // fresh shift opened "now" and is voided in the same Cairo day.
    const today = new Date();
    // A branch holds one open shift at a time; retire the fixture's shift first.
    await database.update(cashierSessions).set({
      closedAt: data.at, closedByAccountId: data.accountId,
    }).where(and(
      eq(cashierSessions.branchId, data.branchId), isNull(cashierSessions.closedAt),
    ));
    const todaySessionId = Number((await database.insert(cashierSessions).values({
      branchId: data.branchId, openedByAccountId: data.accountId, openedAt: today,
    }))[0].insertId);
    const booking = await bookingRepository.create({
      branchId: data.branchId, clientId: data.clientId, actingAccountId: data.accountId,
      scheduledAt: data.at, note: null, services: [{ serviceId: data.serviceId }], createdAt: data.at,
    });
    await bookingRepository.transition(data.branchId, booking.id, ['booked'], 'arrived', data.at);
    await bookingRepository.recordPayment({
      bookingId: booking.id, branchId: data.branchId, cashierSessionId: todaySessionId,
      actorAccountId: data.accountId, actorRole: 'cashier',
      method: 'cash', amount: '100.00', operationReference: crypto.randomUUID(), at: today,
    });
    const invoice = await service.complete({ role: 'cashier', accountId: data.accountId, branchId: data.branchId }, {
      branchId: data.branchId,
      clientId: data.clientId,
      cashierSessionId: todaySessionId,
      bookingId: booking.id,
      bookingCredit: '100.00',
      idempotencyKey: crypto.randomUUID(),
      lines: [{
        itemType: 'service' as const, serviceId: data.serviceId, quantity: 1,
        unitPrice: '200.00', employeeId: data.employeeId,
      }],
      payments: [{ method: 'cash' as const, amount: '100.00' }],
    });
    await saleRepository.reverse({
      invoiceId: invoice.id,
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: today,
      type: 'void',
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'إلغاء فاتورة الحجز',
        payments: [{ method: 'visa', amount: '200.00' }],
      },
    });
    const snapshots = await database.select({ method: invoiceReversalPayments.methodSnapshot, amount: invoiceReversalPayments.amount })
      .from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.invoiceId, invoice.id));
    expect(snapshots).toEqual([{ method: 'visa', amount: '200.00' }]);
  });
});

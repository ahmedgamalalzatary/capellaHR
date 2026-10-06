import {
  accounts,
  auditEvents,
  branches,
  clients,
  employees,
  erpBookingPayments,
  erpBookings,
  erpBookingServices,
  erpCategories,
  erpServices,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import {
  createCashierSessionService,
  createDrizzleCashierSessionRepository,
} from '../../src/modules/erp/sales/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const at = new Date('2026-08-24T08:00:00.000Z');
const tracking = {
  branchIds: [] as number[],
  accountIds: [] as number[],
  employeeIds: [] as number[],
  clientIds: [] as number[],
  bookingIds: [] as number[],
  invoiceIds: [] as number[],
  sessionIds: [] as number[],
};

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
}, 180_000);

afterAll(async () => { await closeMysqlIntegrationDatabase(database); }, 30_000);

afterEach(async () => {
  if (tracking.sessionIds.length > 0) {
    await database.delete(auditEvents).where(and(
      eq(auditEvents.module, 'erp_cashier_sessions'),
      inArray(auditEvents.entityId, tracking.sessionIds.map(String)),
    ));
  }
  // Invoices are fact rows (a trigger blocks their deletion), so only the
  // payment rows that point at the bookings are removed with them.
  if (tracking.invoiceIds.length > 0) {
    await database.delete(invoicePayments).where(inArray(invoicePayments.invoiceId, tracking.invoiceIds));
  }
  await database.delete(erpBookingPayments).where(inArray(erpBookingPayments.branchId, tracking.branchIds));
  await database.delete(erpBookingServices).where(inArray(erpBookingServices.branchId, tracking.branchIds));
  await database.delete(erpBookings).where(inArray(erpBookings.branchId, tracking.branchIds));
  for (const key of Object.keys(tracking) as Array<keyof typeof tracking>) tracking[key].length = 0;
});

const fixture = async () => {
  const branchId = Number((await database.insert(branches).values({
    name: `Shift money ${Date.now()}-${Math.random()}`,
    nameNormalized: `shift-money-${Date.now()}-${Math.random()}`,
    location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 100, createdAt: at, updatedAt: at,
  }))[0].insertId);
  tracking.branchIds.push(branchId);
  const accountId = Number((await database.insert(accounts).values({
    username: `shift.cashier.${Date.now()}-${Math.random()}`.slice(0, 255),
    passwordHash: 'unused', role: 'cashier', employeeId: null, branchId,
    active: true, createdAt: at, updatedAt: at,
  }))[0].insertId);
  tracking.accountIds.push(accountId);
  const clientId = Number((await database.insert(clients).values({
    branchId, fullName: 'Mona',
    phone: `0111${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  tracking.clientIds.push(clientId);
  const employeeId = Number((await database.insert(employees).values({
    employeeCode: 910_000 + Math.floor(Math.random() * 89_999), fullName: 'Sara',
    personalPhone: '01222222222', whatsappPhone: '01233333333', pinHash: 'unused',
    age: 25, address: 'Cairo', branchId, shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00', createdAt: at, updatedAt: at,
  }))[0].insertId);
  tracking.employeeIds.push(employeeId);
  const categoryId = Number((await database.insert(erpCategories).values({
    branchId, type: 'service', name: 'Hair', nameNormalized: `hair-${Date.now()}-${Math.random()}`,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  const serviceId = Number((await database.insert(erpServices).values({
    branchId, categoryId, name: 'Colour', nameNormalized: `colour-${Date.now()}-${Math.random()}`,
    price: '200.00', commissionPercent: '10.00', createdAt: at, updatedAt: at,
  }))[0].insertId);
  const openPriceServiceId = Number((await database.insert(erpServices).values({
    branchId, categoryId, name: 'Open price', nameNormalized: `open-${Date.now()}-${Math.random()}`,
    price: null, commissionPercent: '10.00', createdAt: at, updatedAt: at,
  }))[0].insertId);
  return { branchId, accountId, clientId, employeeId, serviceId, openPriceServiceId };
};

const repository = () => createDrizzleCashierSessionRepository(database, createErpAuditCapability());

const openSession = async (branchId: number, accountId: number) => {
  const opened = await repository().open({ branchId, openedByAccountId: accountId, openedAt: at });
  if (opened.kind !== 'success') throw new Error('Expected the session to open');
  tracking.sessionIds.push(opened.session.id);
  return opened.session.id;
};

const makeBooking = async (
  data: { branchId: number; clientId: number; accountId: number; sessionId: number },
  input: {
    status?: 'booked' | 'arrived' | 'converted';
    scheduledAt: Date;
    pendingServiceIds?: number[];
    payments?: Array<{
      kind: 'payment' | 'refund';
      method: 'cash' | 'visa' | 'instapay' | 'vodafone_cash';
      amount: string;
      refundCause?: 'service_cancelled' | 'checkout_excess';
    }>;
  },
) => {
  const bookingId = Number((await database.insert(erpBookings).values({
    branchId: data.branchId, clientId: data.clientId, scheduledAt: input.scheduledAt,
    status: input.status ?? 'booked', actingAccountId: data.accountId,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  tracking.bookingIds.push(bookingId);
  for (const serviceId of input.pendingServiceIds ?? []) {
    await database.insert(erpBookingServices).values({
      bookingId, branchId: data.branchId, serviceId, status: 'pending',
    });
  }
  let paymentIndex = 0;
  for (const payment of input.payments ?? []) {
    paymentIndex += 1;
    await database.insert(erpBookingPayments).values({
      bookingId, branchId: data.branchId, kind: payment.kind, method: payment.method,
      amount: payment.amount, refundCause: payment.refundCause ?? null,
      cashierSessionId: data.sessionId, actingAccountId: data.accountId,
      operationReference: `018f47a6-7b2f-7c41-91e9-${String(bookingId).padStart(4, '0')}${String(paymentIndex).padStart(4, '0')}`,
      createdAt: at,
    });
  }
  return bookingId;
};

const makeInvoiceWithCredit = async (
  data: {
    branchId: number; clientId: number; employeeId: number; accountId: number;
    sessionId: number; bookingId: number;
  },
) => {
  const invoiceId = Number((await database.insert(invoices).values({
    branchId: data.branchId, clientId: data.clientId, sellerEmployeeId: data.employeeId,
    actingAccountId: data.accountId, cashierSessionId: data.sessionId,
    invoiceNumber: `INV-2026.08.24-09.00-${randomUUID().slice(0, 8)}`,
    idempotencyKey: randomUUID(),
    clientNameSnapshot: 'Mona', sellerNameSnapshot: 'Sara', authorizedBySnapshot: 'shift',
    subtotal: '180.00', total: '180.00', amountPaid: '180.00', settlementStatus: 'settled',
    soldAt: at, createdAt: at,
  }))[0].insertId);
  tracking.invoiceIds.push(invoiceId);
  await database.insert(invoicePayments).values([
    {
      invoiceId, method: 'cash' as const, amount: '80.00', isInitial: true,
      operationReference: randomUUID(), cashierSessionId: data.sessionId,
      actingAccountId: data.accountId, paidAt: at, createdAt: at,
    },
    {
      invoiceId, method: 'booking_credit' as const, amount: '100.00', isInitial: true,
      bookingId: data.bookingId, operationReference: randomUUID(),
      cashierSessionId: data.sessionId, actingAccountId: data.accountId, paidAt: at, createdAt: at,
    },
  ]);
  return invoiceId;
};

describe('ERP shift booking money (MySQL)', () => {
  it('counts booking payments and refunds in the drawer by method and skips booking_credit', async () => {
    const data = await fixture();
    const sessionId = await openSession(data.branchId, data.accountId);
    const bookingId = await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        scheduledAt: at,
        payments: [
          { kind: 'payment', method: 'cash', amount: '150.00' },
          { kind: 'payment', method: 'visa', amount: '50.00' },
          { kind: 'refund', method: 'cash', amount: '30.00', refundCause: 'service_cancelled' },
        ],
      },
    );
    await makeInvoiceWithCredit({
      branchId: data.branchId, clientId: data.clientId, employeeId: data.employeeId,
      accountId: data.accountId, sessionId, bookingId,
    });

    const money = await repository().findMoneyById(sessionId);
    expect(money?.taken).toEqual({
      cash: '230.00', visa: '50.00', instapay: '0.00', vodafone_cash: '0.00',
    });
    expect(money?.refunded).toEqual({
      cash: '30.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00',
    });
    expect(money?.takenTotal).toBe('280.00');
    expect(money?.refundedTotal).toBe('30.00');
  });

  it('lists the invoice with held credit excluded from takenInShift', async () => {
    const data = await fixture();
    const sessionId = await openSession(data.branchId, data.accountId);
    const bookingId = await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      { scheduledAt: at },
    );
    await makeInvoiceWithCredit({
      branchId: data.branchId, clientId: data.clientId, employeeId: data.employeeId,
      accountId: data.accountId, sessionId, bookingId,
    });

    const invoices = await repository().listInvoices(sessionId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ takenInShift: '80.00', refundedInShift: '0.00' });
  });

  it('exposes booking payment and refund blocks in report accounting', async () => {
    const data = await fixture();
    const sessionId = await openSession(data.branchId, data.accountId);
    const bookingId = await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        scheduledAt: at,
        payments: [
          { kind: 'payment', method: 'cash', amount: '150.00' },
          { kind: 'payment', method: 'visa', amount: '50.00' },
          { kind: 'refund', method: 'cash', amount: '30.00', refundCause: 'service_cancelled' },
        ],
      },
    );
    const closedAt = new Date(at.getTime() + 60 * 60_000);
    await repository().close({ branchId: data.branchId, closedByAccountId: data.accountId, closedAt });

    const accounting = await repository().readReportAccounting({
      sessionId, branchId: data.branchId, openedAt: at, closedAt,
    });
    expect(accounting.bookingPayments).toMatchObject({
      total: '200.00',
      lines: [
        { bookingId, client: { id: data.clientId, name: 'Mona' }, method: 'cash', amount: '150.00' },
        { bookingId, client: { id: data.clientId, name: 'Mona' }, method: 'visa', amount: '50.00' },
      ],
    });
    expect(accounting.bookingRefunds).toMatchObject({
      total: '30.00',
      lines: [
        { bookingId, client: { id: data.clientId, name: 'Mona' }, method: 'cash', amount: '30.00' },
      ],
    });
  });

  it('sends the booking money blocks from detail and report services', async () => {
    const data = await fixture();
    const repo = repository();
    const sessionId = await openSession(data.branchId, data.accountId);
    const bookingId = await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        scheduledAt: new Date(at.getTime() + 5 * 60 * 60_000),
        pendingServiceIds: [data.serviceId],
        payments: [
          { kind: 'payment', method: 'cash', amount: '100.00' },
          { kind: 'refund', method: 'cash', amount: '40.00', refundCause: 'service_cancelled' },
        ],
      },
    );
    const closedAt = new Date(at.getTime() + 60 * 60_000);
    const service = createCashierSessionService({
      repository: repo,
      resolveBranchContext: async () => ({
        accountId: data.accountId, accountRole: 'cashier', branchId: data.branchId, employeeId: null,
      }),
      now: () => closedAt,
    });
    const actor = { role: 'cashier' as const, accountId: data.accountId, branchId: data.branchId };

    const detail = await service.detail(actor, sessionId);
    expect(detail.bookingPayments).toMatchObject({
      total: '100.00',
      lines: [{ bookingId, method: 'cash', amount: '100.00' }],
    });
    expect(detail.bookingRefunds).toMatchObject({
      total: '40.00',
      lines: [{ bookingId, method: 'cash', amount: '40.00' }],
    });

    await repo.close({ branchId: data.branchId, closedByAccountId: data.accountId, closedAt });
    const report = await service.report(actor, sessionId);
    expect(report.bookingPayments).toMatchObject({ total: '100.00', lines: [{ bookingId }] });
    expect(report.bookingRefunds).toMatchObject({ total: '40.00', lines: [{ bookingId }] });
  });

  it('blocks close while an arrived booking still has pending services (Q3)', async () => {
    const data = await fixture();
    const repo = repository();
    const sessionId = await openSession(data.branchId, data.accountId);
    await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        status: 'arrived',
        scheduledAt: new Date(at.getTime() + 5 * 60 * 60_000),
        pendingServiceIds: [data.serviceId],
      },
    );

    const closedAt = new Date(at.getTime() + 60 * 60_000);
    await expect(repo.close({
      branchId: data.branchId, closedByAccountId: data.accountId, closedAt,
    })).resolves.toMatchObject({ kind: 'unresolved_bookings', count: 1 });
    await expect(repo.findOpenByBranch(data.branchId)).resolves.not.toBeNull();

    // Auto close never blocks on bookings.
    const closed = await repo.autoCloseExpired({
      openedBefore: new Date(at.getTime() + 17 * 60 * 60_000),
    });
    expect(closed.map((session) => session.id)).toContain(sessionId);
    await expect(repo.findOpenByBranch(data.branchId)).resolves.toBeNull();
  });

  it('blocks close for past-due booked services but not for a later appointment', async () => {
    const data = await fixture();
    const repo = repository();
    const sessionId = await openSession(data.branchId, data.accountId);
    await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        status: 'booked',
        scheduledAt: new Date(at.getTime() - 30 * 60_000),
        pendingServiceIds: [data.serviceId],
      },
    );
    await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        status: 'booked',
        scheduledAt: new Date(at.getTime() + 10 * 60 * 60_000),
        pendingServiceIds: [data.serviceId],
      },
    );

    const closedAt = new Date(at.getTime() + 60 * 60_000);
    await expect(repo.close({
      branchId: data.branchId, closedByAccountId: data.accountId, closedAt,
    })).resolves.toMatchObject({ kind: 'unresolved_bookings', count: 1 });
  });

  it('blocks close while a booking holds more money than its pending services are worth', async () => {
    const data = await fixture();
    const repo = repository();
    const sessionId = await openSession(data.branchId, data.accountId);
    // Excess after checkout: everything sold, nothing pending, 50 still held.
    await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        status: 'converted', scheduledAt: at,
        payments: [{ kind: 'payment', method: 'cash', amount: '50.00' }],
      },
    );
    // Open-price pending service is worth zero, so any held money blocks.
    await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        status: 'arrived', scheduledAt: at,
        pendingServiceIds: [data.openPriceServiceId],
        payments: [{ kind: 'payment', method: 'visa', amount: '20.00' }],
      },
    );

    const closedAt = new Date(at.getTime() + 60 * 60_000);
    await expect(repo.close({
      branchId: data.branchId, closedByAccountId: data.accountId, closedAt,
    })).resolves.toMatchObject({ kind: 'unresolved_bookings', count: 2 });
  });

  it('closes normally once the bookings are resolved', async () => {
    const data = await fixture();
    const repo = repository();
    const sessionId = await openSession(data.branchId, data.accountId);
    const bookingId = await makeBooking(
      { branchId: data.branchId, clientId: data.clientId, accountId: data.accountId, sessionId },
      {
        status: 'arrived', scheduledAt: at, pendingServiceIds: [data.serviceId],
        payments: [{ kind: 'payment', method: 'cash', amount: '100.00' }],
      },
    );

    const closedAt = new Date(at.getTime() + 60 * 60_000);
    await expect(repo.close({
      branchId: data.branchId, closedByAccountId: data.accountId, closedAt,
    })).resolves.toMatchObject({ kind: 'unresolved_bookings', count: 1 });

    await database.transaction(async (transaction) => {
      await transaction.update(erpBookingServices).set({ status: 'cancelled', changedAt: at })
        .where(eq(erpBookingServices.bookingId, bookingId));
      await transaction.insert(erpBookingPayments).values({
        bookingId, branchId: data.branchId, kind: 'refund', method: 'cash', amount: '100.00',
        refundCause: 'service_cancelled', cashierSessionId: sessionId, actingAccountId: data.accountId,
        operationReference: `018f47a6-7b2f-7c41-91e9-${String(bookingId).padStart(4, '0')}9999`,
        createdAt: at,
      });
    });

    await expect(repo.close({
      branchId: data.branchId, closedByAccountId: data.accountId,
      closedAt: new Date(at.getTime() + 61 * 60_000),
    })).resolves.toMatchObject({ kind: 'success' });
  });
});

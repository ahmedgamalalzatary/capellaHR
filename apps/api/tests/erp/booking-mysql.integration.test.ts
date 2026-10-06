import {
  accounts,
  branches,
  cashierSessions,
  clients,
  employees,
  erpBookings,
  erpCategories,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleBookingRepository } from '../../src/modules/erp/bookings/index.js';

const database = createMysqlIntegrationDatabase();
const at = new Date('2026-08-24T08:00:00.000Z');
let accountId = 0;
let branchId = 0;
let clientId = 0;
let employeeId = 0;
let serviceId = 0;

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  accountId = Number((await database.insert(accounts).values({
    username: 'booking-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at,
  }))[0].insertId);
  branchId = Number((await database.insert(branches).values({
    name: 'Booking branch', nameNormalized: 'booking-branch', location: 'Cairo',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  clientId = Number((await database.insert(clients).values({
    branchId, fullName: 'Mona', phone: '01000000001', createdAt: at, updatedAt: at,
  }))[0].insertId);
  employeeId = Number((await database.insert(employees).values({
    employeeCode: 900001, fullName: 'Sara', personalPhone: '01000000002',
    whatsappPhone: '01000000003', pinHash: 'unused', age: 25, address: 'Cairo', branchId,
    shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00', createdAt: at, updatedAt: at,
  }))[0].insertId);
  const categoryId = Number((await database.insert(erpCategories).values({
    branchId, type: 'service', name: 'Hair', nameNormalized: 'hair', createdAt: at, updatedAt: at,
  }))[0].insertId);
  serviceId = Number((await database.insert(erpServices).values({
    branchId, categoryId, name: 'Colour', nameNormalized: 'colour', price: '200.00',
    commissionPercent: '10.00', createdAt: at, updatedAt: at,
  }))[0].insertId);
}, 180_000);

afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
}, 30_000);

describe('MySQL-backed ERP bookings', () => {
  it('lets exactly one concurrent arrival claim the booking', async () => {
    const repository = createDrizzleBookingRepository(database, createErpAuditCapability());
    const created = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-08-25T07:30:00.000Z'),
      note: null, services: [{ serviceId, preferredEmployeeId: employeeId }], createdAt: at,
    });
    const results = await Promise.allSettled([
      repository.transition(branchId, created.id, ['booked'], 'arrived', new Date()),
      repository.transition(branchId, created.id, ['booked'], 'arrived', new Date()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled' && result.value !== null)).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled' && result.value === null)).toHaveLength(1);
  });

  it('lets exactly one invoice convert an arrived booking', async () => {
    const repository = createDrizzleBookingRepository(database, createErpAuditCapability());
    const booking = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-08-26T07:30:00.000Z'),
      note: null, services: [{ serviceId }], createdAt: at,
    });
    await repository.transition(branchId, booking.id, ['booked'], 'arrived', at);
    const sessionId = Number((await database.insert(cashierSessions).values({
      branchId, openedByAccountId: accountId, openedAt: at,
    }))[0].insertId);
    const makeInvoice = async (suffix: string) => {
      const invoiceId = Number((await database.insert(invoices).values({
        branchId, clientId, sellerEmployeeId: employeeId, actingAccountId: accountId,
        cashierSessionId: sessionId, invoiceNumber: `INV-2026.08.24-11.00-${suffix}`,
        idempotencyKey: `018f47a6-7b2f-7c41-91e9-a5dd1d8e16${suffix}`,
        clientNameSnapshot: 'Mona', sellerNameSnapshot: 'Sara', authorizedBySnapshot: 'booking-admin',
        subtotal: '200.00', total: '200.00', amountPaid: '0.00', settlementStatus: 'open',
        soldAt: at, createdAt: at,
      }))[0].insertId);
      const lineId = Number((await database.insert(invoiceLines).values({
        invoiceId, branchId, lineNumber: 1, itemType: 'service', serviceId,
        itemNameSnapshot: 'Colour', quantity: 1, unitPrice: '200.00', lineTotal: '200.00',
        employeeId, employeeNameSnapshot: 'Sara', employeeCodeSnapshot: 900001,
        commissionRuleSnapshot: 'service_default', commissionRateSnapshot: '10.00',
        commissionAmountSnapshot: '20.00',
      }))[0].insertId);
      return { invoiceId, lineId };
    };
    const firstInvoice = await makeInvoice('40');
    const secondInvoice = await makeInvoice('41');
    const convert = (invoice: { invoiceId: number; lineId: number }) => database.transaction((transaction) => repository.applySale(transaction, {
      bookingId: booking.id, branchId, clientId, invoiceId: invoice.invoiceId,
      services: [{ serviceId, invoiceLineId: invoice.lineId, quantity: 1 }], convertedAt: at,
    }));
    const results = await Promise.allSettled([convert(firstInvoice), convert(secondInvoice)]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const stored = (await database.select().from(erpBookings).where(eq(erpBookings.id, booking.id)))[0]!;
    expect(stored.status).toBe('converted');
  });
});

describe('MySQL-backed ERP booking payments', () => {
  const repository = createDrizzleBookingRepository(database, createErpAuditCapability());
  const openSessionAt = new Date('2026-08-24T06:00:00.000Z');
  const expiredSessionAt = new Date('2026-08-23T12:00:00.000Z');
  let openSessionId = 0;
  let expiredSessionId = 0;
  let closedSessionId = 0;
  let cashierAccountId = 0;
  let openPriceServiceId = 0;

  beforeAll(async () => {
    // A branch holds one open shift at a time; retire whatever an earlier test left open.
    await database.update(cashierSessions).set({
      closedAt: at, closedByAccountId: accountId,
    }).where(and(
      eq(cashierSessions.branchId, branchId), isNull(cashierSessions.closedAt),
    ));
    openSessionId = Number((await database.insert(cashierSessions).values({
      branchId, openedByAccountId: accountId, openedAt: openSessionAt,
    }))[0].insertId);
    expiredSessionId = Number((await database.insert(cashierSessions).values({
      branchId, openedByAccountId: accountId, openedAt: expiredSessionAt,
      closedAt: new Date('2026-08-23T20:00:00.000Z'), closedByAccountId: accountId,
    }))[0].insertId);
    closedSessionId = Number((await database.insert(cashierSessions).values({
      branchId, openedByAccountId: accountId, openedAt: openSessionAt,
      closedAt: openSessionAt, closedByAccountId: accountId,
    }))[0].insertId);
    cashierAccountId = Number((await database.insert(accounts).values({
      username: 'booking-cashier', passwordHash: 'unused', role: 'cashier',
      employeeId, createdAt: at, updatedAt: at,
    }))[0].insertId);
    openPriceServiceId = Number((await database.insert(erpServices).values({
      branchId,
      categoryId: (await database.select().from(erpCategories).where(eq(erpCategories.branchId, branchId)))[0]!.id,
      name: 'Open price', nameNormalized: 'open-price', price: null,
      commissionPercent: '10.00', createdAt: at, updatedAt: at,
    }))[0].insertId);
  }, 60_000);

  const pay = (
    bookingId: number,
    operationReference: string,
    amount = '100.00',
    overrides: Partial<Parameters<typeof repository.recordPayment>[0]> = {},
  ) => repository.recordPayment({
    bookingId,
    branchId,
    cashierSessionId: openSessionId,
    actorAccountId: accountId,
    actorRole: 'admin',
    method: 'cash',
    amount,
    operationReference,
    at,
    ...overrides,
  });

  const money = async (bookingId: number) => {
    const record = await repository.findById(branchId, bookingId);
    return record!.money;
  };

  it('computes the money summary from the ledger and current prices, ignoring open-price services', async () => {
    const booking = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-08-27T07:30:00.000Z'),
      note: null, services: [{ serviceId }, { serviceId: openPriceServiceId }], createdAt: at,
    });
    const record = await pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1700');
    expect(record.money).toEqual({
      paid: '100.00', refunded: '0.00', applied: '0.00', held: '100.00',
      pendingValue: '200.00', maxPayable: '100.00', excess: '0.00',
    });
    expect(record.services.map((service) => service.status)).toEqual(['pending', 'pending']);
  });

  it('caps up-front payments at the pending services value minus held money', async () => {
    const booking = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-08-28T07:30:00.000Z'),
      note: null, services: [{ serviceId }], createdAt: at,
    });
    await pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1701');
    await pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1702');
    expect(await money(booking.id)).toMatchObject({ paid: '200.00', maxPayable: '0.00' });
    await expect(pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1703', '0.01'))
      .rejects.toMatchObject({ code: 'BOOKING_PAYMENT_EXCEEDS_CAP' });
    expect(await money(booking.id)).toMatchObject({ paid: '200.00' });
  });

  it('replays the same operation reference without a second row and conflicts on a different body', async () => {
    const booking = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-08-29T07:30:00.000Z'),
      note: null, services: [{ serviceId }], createdAt: at,
    });
    await pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1704');
    const replay = await pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1704');
    expect(replay.money).toMatchObject({ paid: '100.00' });
    await expect(pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1704', '150.00'))
      .rejects.toMatchObject({ code: 'BOOKING_OPERATION_CONFLICT' });
  });

  it('requires an open, unexpired shift owned by the acting cashier', async () => {
    const booking = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-08-30T07:30:00.000Z'),
      note: null, services: [{ serviceId }], createdAt: at,
    });
    await expect(pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1705', '100.00', { cashierSessionId: closedSessionId }))
      .rejects.toMatchObject({ code: 'BOOKING_CASHIER_SESSION_NOT_OPEN' });
    await expect(pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1706', '100.00', { cashierSessionId: expiredSessionId }))
      .rejects.toMatchObject({ code: 'BOOKING_CASHIER_SESSION_NOT_OPEN' });
    await expect(pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1707', '100.00', {
      actorAccountId: cashierAccountId, actorRole: 'cashier',
    })).rejects.toMatchObject({ code: 'BOOKING_CASHIER_SESSION_NOT_OPEN' });
  });

  it('reports applied booking credit from the invoice payments it was spent through', async () => {
    const booking = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-08-31T07:30:00.000Z'),
      note: null, services: [{ serviceId }], createdAt: at,
    });
    await pay(booking.id, '018f47a6-7b2f-7c41-91e9-a5dd1d8e1709', '150.00');
    const invoiceId = Number((await database.insert(invoices).values({
      branchId, clientId, sellerEmployeeId: employeeId, actingAccountId: accountId,
      cashierSessionId: openSessionId, invoiceNumber: 'INV-2026.08.24-11.00-50',
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1710',
      clientNameSnapshot: 'Mona', sellerNameSnapshot: 'Sara', authorizedBySnapshot: 'booking-admin',
      subtotal: '200.00', total: '200.00', amountPaid: '150.00', settlementStatus: 'open',
      soldAt: at, createdAt: at,
    }))[0].insertId);
    await database.insert(invoicePayments).values({
      invoiceId, method: 'booking_credit', amount: '150.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1711',
      bookingId: booking.id, cashierSessionId: openSessionId,
      actingAccountId: accountId, paidAt: at, createdAt: at,
    });
    expect(await money(booking.id)).toMatchObject({
      paid: '150.00', applied: '150.00', held: '0.00', maxPayable: '200.00',
    });
  });
});

describe('MySQL-backed ERP booking leftovers', () => {
  const repository = createDrizzleBookingRepository(database, createErpAuditCapability());
  const openSessionAt = new Date('2026-08-24T06:00:00.000Z');
  let leftoverSessionId = 0;
  let cheapServiceId = 0;

  beforeAll(async () => {
    await database.update(cashierSessions).set({
      closedAt: openSessionAt, closedByAccountId: accountId,
    }).where(and(
      eq(cashierSessions.branchId, branchId), isNull(cashierSessions.closedAt),
    ));
    leftoverSessionId = Number((await database.insert(cashierSessions).values({
      branchId, openedByAccountId: accountId, openedAt: openSessionAt,
    }))[0].insertId);
    cheapServiceId = Number((await database.insert(erpServices).values({
      branchId,
      categoryId: (await database.select().from(erpCategories).where(eq(erpCategories.branchId, branchId)))[0]!.id,
      name: 'Cheap extra', nameNormalized: 'cheap-extra', price: '100.00',
      commissionPercent: '10.00', createdAt: at, updatedAt: at,
    }))[0].insertId);
  }, 60_000);

  const arrangeBooking = async (services: number[], paid: string) => {
    const booking = await repository.create({
      branchId, clientId, actingAccountId: accountId,
      scheduledAt: new Date('2026-09-01T07:30:00.000Z'),
      note: null, services: services.map((serviceId) => ({ serviceId })), createdAt: at,
    });
    await repository.transition(branchId, booking.id, ['booked'], 'arrived', at);
    if (paid !== '0.00') {
      await repository.recordPayment({
        bookingId: booking.id, branchId, cashierSessionId: leftoverSessionId,
        actorAccountId: accountId, actorRole: 'admin',
        method: 'cash', amount: paid, operationReference: crypto.randomUUID(), at,
      });
    }
    return booking.id;
  };

  it('cancels pending services and refunds the exact server-computed excess', async () => {
    const bookingId = await arrangeBooking([serviceId, cheapServiceId], '150.00');
    await expect(repository.cancelServices({
      bookingId, branchId, serviceIds: [serviceId],
      actorAccountId: accountId, actorRole: 'admin', at,
    })).rejects.toMatchObject({
      code: 'BOOKING_REFUND_REQUIRED',
      details: { amount: '50.00' },
    });
    await expect(repository.cancelServices({
      bookingId, branchId, serviceIds: [serviceId],
      actorAccountId: accountId, actorRole: 'admin', at,
      refund: {
        cashierSessionId: leftoverSessionId,
        payments: [{ method: 'cash', amount: '40.00' }],
        operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1720',
      },
    })).rejects.toMatchObject({ code: 'BOOKING_REFUND_AMOUNT_MISMATCH' });
    const record = await repository.cancelServices({
      bookingId, branchId, serviceIds: [serviceId],
      actorAccountId: accountId, actorRole: 'admin', at,
      refund: {
        cashierSessionId: leftoverSessionId,
        payments: [{ method: 'cash', amount: '50.00' }],
        operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1720',
      },
    });
    expect(record!.services.find((line) => line.serviceId === serviceId)!.status).toBe('cancelled');
    expect(record!.money).toMatchObject({
      paid: '150.00', refunded: '50.00', held: '100.00', maxPayable: '0.00',
    });
    // A replay of the same refund is recognized instead of duplicating the money.
    const replay = await repository.cancelServices({
      bookingId, branchId, serviceIds: [serviceId],
      actorAccountId: accountId, actorRole: 'admin', at,
      refund: {
        cashierSessionId: leftoverSessionId,
        payments: [{ method: 'cash', amount: '50.00' }],
        operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1720',
      },
    });
    expect(replay!.money).toMatchObject({ refunded: '50.00' });
  });

  it('cancels with zero held money without any refund block', async () => {
    const bookingId = await arrangeBooking([serviceId, cheapServiceId], '0.00');
    const record = await repository.cancelServices({
      bookingId, branchId, serviceIds: [serviceId],
      actorAccountId: accountId, actorRole: 'admin', at,
    });
    expect(record!.money).toMatchObject({ paid: '0.00', refunded: '0.00' });
    expect(record!.status).toBe('arrived');
  });

  it('changes nothing when the refund shift is not open for the cashier', async () => {
    const bookingId = await arrangeBooking([serviceId, cheapServiceId], '150.00');
    await expect(repository.cancelServices({
      bookingId, branchId, serviceIds: [cheapServiceId],
      actorAccountId: accountId, actorRole: 'admin', at,
      refund: {
        cashierSessionId: 0,
        payments: [{ method: 'cash', amount: '50.00' }],
        operationReference: crypto.randomUUID(),
      },
    })).rejects.toMatchObject({ code: 'BOOKING_CASHIER_SESSION_NOT_OPEN' });
    const record = await repository.findById(branchId, bookingId);
    expect(record!.services.every((line) => line.status === 'pending')).toBe(true);
    expect(record!.money).toMatchObject({ refunded: '0.00' });
  });

  it('cancels the whole booking through the no-show path with a full-excess refund', async () => {
    const bookingId = await arrangeBooking([serviceId, cheapServiceId], '150.00');
    const past = new Date('2026-08-20T07:30:00.000Z');
    await database.update(erpBookings).set({ scheduledAt: past }).where(eq(erpBookings.id, bookingId));
    const record = await repository.finalizeCancellation({
      bookingId, branchId, status: 'no_show',
      actorAccountId: accountId, actorRole: 'admin', at,
      refund: {
        cashierSessionId: leftoverSessionId,
        payments: [{ method: 'cash', amount: '150.00' }],
        operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1721',
      },
    });
    expect(record!.status).toBe('no_show');
    expect(record!.services.every((line) => line.status === 'cancelled')).toBe(true);
    expect(record!.money).toMatchObject({ paid: '150.00', refunded: '150.00', held: '0.00' });
    // A no-show before the appointment stays forbidden.
    const futureId = await arrangeBooking([serviceId], '0.00');
    await expect(repository.finalizeCancellation({
      bookingId: futureId, branchId, status: 'no_show',
      actorAccountId: accountId, actorRole: 'admin', at,
    })).resolves.toBeNull();
  });

  it('reschedules a pending booking and rewinds arrived bookings to booked', async () => {
    const bookingId = await arrangeBooking([serviceId], '0.00');
    const newDate = new Date('2026-09-10T09:00:00.000Z');
    const record = await repository.reschedule({
      bookingId, branchId, scheduledAt: newDate, at,
    });
    expect(record!.status).toBe('booked');
    expect(record!.scheduledAt).toEqual(newDate);
    await repository.transition(branchId, bookingId, ['booked'], 'arrived', at);
    const later = await repository.reschedule({
      bookingId, branchId, scheduledAt: new Date('2026-09-12T09:00:00.000Z'), at,
    });
    expect(later!.status).toBe('booked');
  });

  it('refuses to delete a booking with money attached but allows a clean one', async () => {
    const withMoney = await arrangeBooking([serviceId], '50.00');
    await expect(repository.remove(branchId, withMoney)).resolves.toBeNull();
    const cleanId = await arrangeBooking([cheapServiceId], '0.00');
    await repository.cancelServices({
      bookingId: cleanId, branchId, serviceIds: [cheapServiceId],
      actorAccountId: accountId, actorRole: 'admin', at,
    });
    await expect(repository.remove(branchId, cleanId)).resolves.toMatchObject({ id: cleanId });
  });
});

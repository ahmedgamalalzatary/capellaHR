import { createDatabase } from '@capella/database';
import {
  accounts,
  branches,
  cashierSessions,
  clients,
  employees,
  erpBookings,
  erpCategories,
  erpServices,
  invoices,
} from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleBookingRepository } from '../../src/modules/erp/bookings/index.js';

const control = createDatabase(process.env.DATABASE_URL ?? '');
const databaseName = `capella_hr_test_bookings_${process.pid}_${Date.now()}`;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabase(databaseUrl.toString());
const at = new Date('2026-08-24T08:00:00.000Z');
let accountId = 0;
let branchId = 0;
let clientId = 0;
let employeeId = 0;
let serviceId = 0;

beforeAll(async () => {
  if (!/^capella_hr_test_bookings_\d+_\d+$/u.test(databaseName)) throw new Error('Unsafe test database');
  await control.execute(sql.raw(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));
  await migrate(database, {
    migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/database/migrations'),
  });
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
  await database.$client.promise().end();
  await control.execute(sql.raw(`DROP DATABASE IF EXISTS \`${databaseName}\``));
  await control.$client.promise().end();
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
    const makeInvoice = async (suffix: string) => Number((await database.insert(invoices).values({
      branchId, clientId, sellerEmployeeId: employeeId, actingAccountId: accountId,
      cashierSessionId: sessionId, invoiceNumber: `INV-2026.08.24-11.00-${suffix}`,
      idempotencyKey: `018f47a6-7b2f-7c41-91e9-a5dd1d8e16${suffix}`,
      clientNameSnapshot: 'Mona', sellerNameSnapshot: 'Sara', authorizedBySnapshot: 'booking-admin',
      subtotal: '200.00', total: '200.00', amountPaid: '0.00', settlementStatus: 'open',
      soldAt: at, createdAt: at,
    }))[0].insertId);
    const firstInvoiceId = await makeInvoice('40');
    const secondInvoiceId = await makeInvoice('41');
    const convert = (invoiceId: number) => database.transaction((transaction) => repository.convert(transaction, {
      bookingId: booking.id, branchId, clientId, invoiceId, serviceIds: [serviceId], convertedAt: at,
    }));
    const results = await Promise.allSettled([convert(firstInvoiceId), convert(secondInvoiceId)]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const stored = (await database.select().from(erpBookings).where(eq(erpBookings.id, booking.id)))[0]!;
    expect(stored.status).toBe('converted');
    expect([firstInvoiceId, secondInvoiceId]).toContain(stored.invoiceId);
  });
});

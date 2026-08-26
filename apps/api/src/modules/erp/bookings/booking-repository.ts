import { type createDatabase } from '@capella/database';
import {
  clients,
  employees,
  erpBookingServices,
  erpBookings,
  erpServices,
} from '@capella/database/schema';
import { and, asc, countDistinct, eq, gt, gte, inArray, lt } from 'drizzle-orm';

import { startOfCairoDate } from '../cairo-calendar.js';
import type { ErpAuditCapability } from '../hr-capabilities.js';
import {
  BookingError,
  type BookingConversionInput,
  type BookingRecord,
  type BookingRepository,
} from './booking-service.js';

type Database = ReturnType<typeof createDatabase>;
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
const AUDIT_MODULE = 'erp-bookings';

const nextDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

const hydrate = async (
  executor: Executor,
  branchId: number,
  id: number,
): Promise<BookingRecord | null> => {
  const row = (await executor.select({
    id: erpBookings.id,
    branchId: erpBookings.branchId,
    clientId: clients.id,
    clientName: clients.fullName,
    clientPhone: clients.phone,
    scheduledAt: erpBookings.scheduledAt,
    status: erpBookings.status,
    note: erpBookings.note,
    invoiceId: erpBookings.invoiceId,
    createdAt: erpBookings.createdAt,
    updatedAt: erpBookings.updatedAt,
  }).from(erpBookings).innerJoin(clients, eq(clients.id, erpBookings.clientId))
    .where(and(eq(erpBookings.branchId, branchId), eq(erpBookings.id, id))).limit(1))[0];
  if (!row) return null;
  const services = await executor.select({
    serviceId: erpBookingServices.serviceId,
    serviceName: erpServices.name,
    servicePrice: erpServices.price,
    employeeId: employees.id,
    employeeName: employees.fullName,
  }).from(erpBookingServices)
    .innerJoin(erpServices, eq(erpServices.id, erpBookingServices.serviceId))
    .leftJoin(employees, eq(employees.id, erpBookingServices.preferredEmployeeId))
    .where(eq(erpBookingServices.bookingId, id)).orderBy(asc(erpBookingServices.id));
  return {
    id: row.id,
    branchId: row.branchId,
    client: { id: row.clientId, fullName: row.clientName, phone: row.clientPhone },
    scheduledAt: row.scheduledAt,
    status: row.status,
    note: row.note,
    invoiceId: row.invoiceId,
    services: services.map((service) => ({
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      servicePrice: service.servicePrice,
      preferredEmployee: service.employeeId === null ? null : {
        id: service.employeeId,
        name: service.employeeName ?? '',
      },
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

export const createDrizzleBookingRepository = (
  database: Database,
  audit: ErpAuditCapability,
): BookingRepository => ({
  async create(input) {
    return database.transaction(async (transaction) => {
      const client = (await transaction.select({ id: clients.id }).from(clients).where(and(
        eq(clients.id, input.clientId), eq(clients.branchId, input.branchId),
      )).limit(1))[0];
      if (!client) throw new BookingError('BOOKING_CLIENT_NOT_FOUND');

      const serviceIds = input.services.map(({ serviceId }) => serviceId);
      const validServices = await transaction.select({ id: erpServices.id }).from(erpServices)
        .where(and(
          eq(erpServices.branchId, input.branchId),
          eq(erpServices.isActive, true),
          inArray(erpServices.id, serviceIds),
        ));
      if (validServices.length !== serviceIds.length) {
        throw new BookingError('BOOKING_SERVICE_NOT_FOUND');
      }

      const employeeIds = [...new Set(input.services.flatMap((line) => (
        line.preferredEmployeeId === undefined ? [] : [line.preferredEmployeeId]
      )))];
      if (employeeIds.length) {
        const validEmployees = await transaction.select({ id: employees.id }).from(employees)
          .where(and(
            eq(employees.branchId, input.branchId),
            eq(employees.employmentStatus, 'active'),
            inArray(employees.id, employeeIds),
          ));
        if (validEmployees.length !== employeeIds.length) {
          throw new BookingError('BOOKING_EMPLOYEE_NOT_FOUND');
        }
      }

      const inserted = await transaction.insert(erpBookings).values({
        branchId: input.branchId,
        clientId: input.clientId,
        scheduledAt: input.scheduledAt,
        note: input.note,
        actingAccountId: input.actingAccountId,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
      const id = Number(inserted[0].insertId);
      await transaction.insert(erpBookingServices).values(input.services.map((service) => ({
        bookingId: id,
        branchId: input.branchId,
        serviceId: service.serviceId,
        preferredEmployeeId: service.preferredEmployeeId ?? null,
      })));
      const record = (await hydrate(transaction, input.branchId, id))!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'create',
        entityType: 'booking',
        entityId: id,
        afterState: record,
        relatedIds: { branchId: input.branchId, clientId: input.clientId },
        createdAt: input.createdAt,
      });
      return record;
    });
  },

  findById(branchId, id) {
    return hydrate(database, branchId, id);
  },

  async listDay(branchId, date) {
    const start = startOfCairoDate(date);
    const end = startOfCairoDate(nextDate(date));
    const rows = await database.select({
      id: erpBookings.id,
      branchId: erpBookings.branchId,
      clientId: clients.id,
      clientName: clients.fullName,
      clientPhone: clients.phone,
      scheduledAt: erpBookings.scheduledAt,
      status: erpBookings.status,
      note: erpBookings.note,
      invoiceId: erpBookings.invoiceId,
      createdAt: erpBookings.createdAt,
      updatedAt: erpBookings.updatedAt,
    }).from(erpBookings).innerJoin(clients, eq(clients.id, erpBookings.clientId)).where(and(
      eq(erpBookings.branchId, branchId),
      gte(erpBookings.scheduledAt, start),
      lt(erpBookings.scheduledAt, end),
    )).orderBy(asc(erpBookings.scheduledAt), asc(erpBookings.id));
    if (rows.length === 0) return [];
    const services = await database.select({
      bookingId: erpBookingServices.bookingId,
      serviceId: erpBookingServices.serviceId,
      serviceName: erpServices.name,
      servicePrice: erpServices.price,
      employeeId: employees.id,
      employeeName: employees.fullName,
    }).from(erpBookingServices)
      .innerJoin(erpServices, eq(erpServices.id, erpBookingServices.serviceId))
      .leftJoin(employees, eq(employees.id, erpBookingServices.preferredEmployeeId))
      .where(and(eq(erpBookingServices.branchId, branchId), inArray(erpBookingServices.bookingId, rows.map(({ id }) => id))))
      .orderBy(asc(erpBookingServices.id));
    const servicesByBooking = new Map<number, typeof services>();
    for (const service of services) {
      const list = servicesByBooking.get(service.bookingId) ?? [];
      list.push(service);
      servicesByBooking.set(service.bookingId, list);
    }
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branchId,
      client: { id: row.clientId, fullName: row.clientName, phone: row.clientPhone },
      scheduledAt: row.scheduledAt,
      status: row.status,
      note: row.note,
      invoiceId: row.invoiceId,
      services: (servicesByBooking.get(row.id) ?? []).map((service) => ({
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        servicePrice: service.servicePrice,
        preferredEmployee: service.employeeId === null ? null : { id: service.employeeId, name: service.employeeName ?? '' },
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },

  async transition(branchId, id, from, to, changedAt) {
    return database.transaction(async (transaction) => {
      const scope = and(
        eq(erpBookings.id, id),
        eq(erpBookings.branchId, branchId),
        inArray(erpBookings.status, from),
        ...(to === 'no_show' ? [lt(erpBookings.scheduledAt, changedAt)] : []),
      );
      const before = (await transaction.select().from(erpBookings).where(scope)
        .for('update').limit(1))[0];
      if (!before) return null;
      const result = await transaction.update(erpBookings)
        .set({ status: to, updatedAt: changedAt }).where(scope);
      if (result[0].affectedRows !== 1) return null;
      const record = (await hydrate(transaction, branchId, id))!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'status-change',
        entityType: 'booking',
        entityId: id,
        beforeState: before,
        afterState: record,
        relatedIds: { branchId },
        createdAt: changedAt,
      });
      return record;
    });
  },

  async countFutureForEmployee(employeeId, now) {
    const rows = await database.select({ count: countDistinct(erpBookings.id) }).from(erpBookings)
      .innerJoin(erpBookingServices, eq(erpBookingServices.bookingId, erpBookings.id))
      .where(and(
        eq(erpBookingServices.preferredEmployeeId, employeeId),
        inArray(erpBookings.status, ['booked', 'arrived']),
        gt(erpBookings.scheduledAt, now),
      ));
    return Number(rows[0]?.count ?? 0);
  },

  listActiveEmployees(branchId) {
    return database.select({ id: employees.id, name: employees.fullName }).from(employees)
      .where(and(
        eq(employees.branchId, branchId),
        eq(employees.employmentStatus, 'active'),
      )).orderBy(asc(employees.fullName), asc(employees.id));
  },

  async convert(transaction, input: BookingConversionInput) {
    const scope = and(
      eq(erpBookings.id, input.bookingId),
      eq(erpBookings.branchId, input.branchId),
      eq(erpBookings.clientId, input.clientId),
      eq(erpBookings.status, 'arrived'),
    );
    const booking = (await transaction.select().from(erpBookings).where(scope)
      .for('update').limit(1))[0];
    if (!booking) throw new BookingError('BOOKING_ALREADY_HANDLED');
    const bookedServices = await transaction.select({ serviceId: erpBookingServices.serviceId })
      .from(erpBookingServices).where(eq(erpBookingServices.bookingId, input.bookingId));
    const expected = [...new Set(bookedServices.map(({ serviceId }) => serviceId))].sort();
    const actual = [...new Set(input.serviceIds)].sort();
    if (expected.length !== actual.length
      || expected.some((serviceId, index) => serviceId !== actual[index])) {
      throw new BookingError('BOOKING_SERVICE_NOT_FOUND', 'خدمات البيع لا تطابق خدمات الحجز');
    }
    const result = await transaction.update(erpBookings).set({
      status: 'converted',
      invoiceId: input.invoiceId,
      updatedAt: input.convertedAt,
    }).where(scope);
    if (result[0].affectedRows !== 1) throw new BookingError('BOOKING_ALREADY_HANDLED');
    const record = (await hydrate(transaction, input.branchId, input.bookingId))!;
    await audit.record(transaction, {
      module: AUDIT_MODULE,
      action: 'convert',
      entityType: 'booking',
      entityId: input.bookingId,
      beforeState: booking,
      afterState: record,
      relatedIds: { branchId: input.branchId, invoiceId: input.invoiceId },
      createdAt: input.convertedAt,
    });
  },

  async updatePreference(branchId, bookingId, serviceId, employeeId, changedAt) {
    return database.transaction(async (transaction) => {
      const booking = (await transaction.select().from(erpBookings).where(and(
        eq(erpBookings.id, bookingId),
        eq(erpBookings.branchId, branchId),
        inArray(erpBookings.status, ['booked', 'arrived']),
      )).for('update').limit(1))[0];
      if (!booking) return null;
      if (employeeId !== null) {
        const employee = (await transaction.select({ id: employees.id }).from(employees)
          .where(and(
            eq(employees.id, employeeId),
            eq(employees.branchId, branchId),
            eq(employees.employmentStatus, 'active'),
          )).limit(1))[0];
        if (!employee) throw new BookingError('BOOKING_EMPLOYEE_NOT_FOUND');
      }
      const result = await transaction.update(erpBookingServices)
        .set({ preferredEmployeeId: employeeId })
        .where(and(
          eq(erpBookingServices.bookingId, bookingId),
          eq(erpBookingServices.branchId, branchId),
          eq(erpBookingServices.serviceId, serviceId),
        ));
      if (result[0].affectedRows !== 1) throw new BookingError('BOOKING_SERVICE_NOT_FOUND');
      await transaction.update(erpBookings).set({ updatedAt: changedAt })
        .where(eq(erpBookings.id, bookingId));
      const record = (await hydrate(transaction, branchId, bookingId))!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'change-preference',
        entityType: 'booking',
        entityId: bookingId,
        beforeState: booking,
        afterState: record,
        relatedIds: { branchId, serviceId, ...(employeeId === null ? {} : { employeeId }) },
        createdAt: changedAt,
      });
      return record;
    });
  },
});

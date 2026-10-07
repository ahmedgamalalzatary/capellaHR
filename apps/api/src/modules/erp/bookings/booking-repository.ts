import { type createDatabase } from '@capella/database';
import {
  cashierSessions,
  clients,
  employees,
  erpBookingPayments,
  erpBookingServices,
  erpBookings,
  erpServices,
  invoicePayments,
  invoices,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, asc, countDistinct, eq, gt, gte, inArray, like, lt, or, sql } from 'drizzle-orm';

import { startOfCairoDate } from '../cairo-calendar.js';
import type { ErpAuditCapability } from '../hr-capabilities.js';
import { CASHIER_SESSION_MAX_DURATION_MS, signedMoney, toCents } from '../sales/index.js';
import { BookingError } from './booking-service.js';
import type {
  BookingConversionInput,
  BookingPaymentWrite,
  BookingRecord,
  BookingRefundWrite,
  BookingRepository,
} from './booking-service.js';
import { bookingRefundRowReference, buildBookingMoney, sumServicePrices } from './booking-money.js';

type Database = ReturnType<typeof createDatabase>;
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const AUDIT_MODULE = 'erp-bookings';

const nextDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

// The shift row is locked on its own, without the "still open" filter, so a
// caller can tell "the shift already closed" from "the shift is fine" before
// deciding whether a retry may still be replayed.
const lockShiftRow = (
  transaction: Transaction,
  input: { cashierSessionId: number; branchId: number },
) => {
  if (input.cashierSessionId <= 0) throw new BookingError('BOOKING_CASHIER_SESSION_NOT_OPEN');
  return transaction.select().from(cashierSessions).where(and(
    eq(cashierSessions.id, input.cashierSessionId),
    eq(cashierSessions.branchId, input.branchId),
  )).for('update').limit(1).then(([session]) => session ?? null);
};

const assertShiftOwnedBy = (
  session: { openedByAccountId: number },
  input: { actorAccountId: number; actorRole: 'admin' | 'cashier' },
) => {
  if (input.actorRole === 'cashier' && session.openedByAccountId !== input.actorAccountId) {
    throw new BookingError('BOOKING_CASHIER_SESSION_NOT_OPEN');
  }
};

// Strictly after the limit: the sweep spends a shift that reaches it.
const shiftStillTakesMoney = (
  session: { closedAt: Date | null; openedAt: Date },
  at: Date,
) => session.closedAt === null
  && session.openedAt.getTime() > at.getTime() - CASHIER_SESSION_MAX_DURATION_MS;

/**
 * A retried cancel that carries a refund replays only when that exact refund was
 * recorded under its reference. Answering success otherwise would tell the
 * cashier money went back when it never did.
 */
const assertRefundReplayed = async (
  transaction: Transaction,
  bookingId: number,
  refund: BookingRefundWrite | undefined,
) => {
  if (!refund) return;
  const stored = await transaction.select({
    method: erpBookingPayments.method,
    amount: erpBookingPayments.amount,
  }).from(erpBookingPayments).where(and(
    eq(erpBookingPayments.bookingId, bookingId),
    eq(erpBookingPayments.kind, 'refund'),
    or(
      eq(erpBookingPayments.operationReference, refund.operationReference),
      like(erpBookingPayments.operationReference, `${refund.operationReference.slice(0, 33)}-%`),
    ),
  )).orderBy(asc(erpBookingPayments.id));
  const same = stored.length === refund.payments.length
    && stored.every((row, index) => row.method === refund.payments[index]!.method
      && toCents(row.amount) === toCents(refund.payments[index]!.amount));
  if (!same) throw new BookingError('BOOKING_OPERATION_CONFLICT');
};

const insertRefundRows = async (
  transaction: Transaction,
  input: {
    bookingId: number;
    branchId: number;
    cause: 'service_cancelled' | 'booking_cancelled' | 'no_show';
    actorAccountId: number;
    at: Date;
    refund: BookingRefundWrite;
  },
) => {
  // One ledger row per payment method; the operation reference identifies the
  // command and the suffix keeps the per-row uniqueness intact.
  await transaction.insert(erpBookingPayments).values(input.refund.payments.map((payment, index) => ({
    bookingId: input.bookingId,
    branchId: input.branchId,
    kind: 'refund' as const,
    method: payment.method,
    amount: payment.amount,
    refundCause: input.cause,
    cashierSessionId: input.refund.cashierSessionId,
    actingAccountId: input.actorAccountId,
    operationReference: bookingRefundRowReference(input.refund.operationReference, index),
    createdAt: input.at,
  })));
};

const assertRefundCoversExcess = (
  refund: BookingRefundWrite,
  excessCents: bigint,
) => {
  const offered = refund.payments.reduce((sum, payment) => sum + toCents(payment.amount), 0n);
  if (offered !== excessCents) {
    throw new BookingError('BOOKING_REFUND_AMOUNT_MISMATCH');
  }
};

const pendingValueOf = async (transaction: Transaction, bookingId: number) => {
  const pending = await transaction.select({ price: erpServices.price })
    .from(erpBookingServices)
    .innerJoin(erpServices, eq(erpServices.id, erpBookingServices.serviceId))
    .where(and(
      eq(erpBookingServices.bookingId, bookingId),
      eq(erpBookingServices.status, 'pending'),
    ));
  return sumServicePrices(pending.map((service) => service.price));
};

type MoneyTotals = { paymentsTotal: bigint; refundsTotal: bigint; appliedTotal: bigint };

const bookingPaymentsTotals = async (
  executor: Executor,
  branchId: number | null,
  bookingIds: number[],
): Promise<Map<number, MoneyTotals>> => {
  const totals = new Map<number, MoneyTotals>();
  if (bookingIds.length === 0) return totals;
  const rows = await executor.select({
    bookingId: erpBookingPayments.bookingId,
    kind: erpBookingPayments.kind,
    total: sql<string>`coalesce(sum(${erpBookingPayments.amount}), 0)`,
  }).from(erpBookingPayments).where(and(
    ...(branchId === null ? [] : [eq(erpBookingPayments.branchId, branchId)]),
    inArray(erpBookingPayments.bookingId, bookingIds),
  )).groupBy(erpBookingPayments.bookingId, erpBookingPayments.kind);
  for (const row of rows) {
    const entry = totals.get(row.bookingId) ?? { paymentsTotal: 0n, refundsTotal: 0n, appliedTotal: 0n };
    if (row.kind === 'payment') entry.paymentsTotal += toCents(row.total);
    else entry.refundsTotal += toCents(row.total);
    totals.set(row.bookingId, entry);
  }
  const appliedRows = await executor.select({
    bookingId: invoicePayments.bookingId,
    total: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)`,
  }).from(invoicePayments).where(inArray(invoicePayments.bookingId, bookingIds))
    .groupBy(invoicePayments.bookingId);
  for (const row of appliedRows) {
    const entry = totals.get(row.bookingId!) ?? { paymentsTotal: 0n, refundsTotal: 0n, appliedTotal: 0n };
    entry.appliedTotal += toCents(row.total);
    totals.set(row.bookingId!, entry);
  }
  return totals;
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
    status: erpBookingServices.status,
    invoiceId: erpBookingServices.invoiceId,
    invoiceNumber: invoices.invoiceNumber,
    queueStatus: serviceQueueEntries.status,
  }).from(erpBookingServices)
    .innerJoin(erpServices, eq(erpServices.id, erpBookingServices.serviceId))
    .leftJoin(employees, eq(employees.id, erpBookingServices.preferredEmployeeId))
    .leftJoin(invoices, and(
      eq(invoices.id, erpBookingServices.invoiceId),
      eq(invoices.branchId, erpBookingServices.branchId),
    ))
    .leftJoin(serviceQueueEntries, eq(serviceQueueEntries.invoiceLineId, erpBookingServices.invoiceLineId))
    .where(eq(erpBookingServices.bookingId, id)).orderBy(asc(erpBookingServices.id));
  const totals = (await bookingPaymentsTotals(executor, branchId, [id])).get(id)
    ?? { paymentsTotal: 0n, refundsTotal: 0n, appliedTotal: 0n };
  return {
    id: row.id,
    branchId: row.branchId,
    client: { id: row.clientId, fullName: row.clientName, phone: row.clientPhone },
    scheduledAt: row.scheduledAt,
    status: row.status,
    note: row.note,
    money: buildBookingMoney({
      ...totals,
      pendingValueTotal: sumServicePrices(
        services.filter((service) => service.status === 'pending').map((service) => service.servicePrice),
      ),
    }),
    services: services.map((service) => ({
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      servicePrice: service.servicePrice,
      preferredEmployee: service.employeeId === null ? null : {
        id: service.employeeId,
        name: service.employeeName ?? '',
      },
      status: service.status,
      invoiceId: service.invoiceId,
      invoiceNumber: service.invoiceNumber,
      queueStatus: service.queueStatus,
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
      createdAt: erpBookings.createdAt,
      updatedAt: erpBookings.updatedAt,
    }).from(erpBookings).innerJoin(clients, eq(clients.id, erpBookings.clientId)).where(and(
      eq(erpBookings.branchId, branchId),
      gte(erpBookings.scheduledAt, start),
      lt(erpBookings.scheduledAt, end),
    )).orderBy(asc(erpBookings.scheduledAt), asc(erpBookings.id));
    if (rows.length === 0) return [];
    const bookingIds = rows.map(({ id }) => id);
    const services = await database.select({
      bookingId: erpBookingServices.bookingId,
      serviceId: erpBookingServices.serviceId,
      serviceName: erpServices.name,
      servicePrice: erpServices.price,
      employeeId: employees.id,
      employeeName: employees.fullName,
      status: erpBookingServices.status,
      invoiceId: erpBookingServices.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      queueStatus: serviceQueueEntries.status,
    }).from(erpBookingServices)
      .innerJoin(erpServices, eq(erpServices.id, erpBookingServices.serviceId))
      .leftJoin(employees, eq(employees.id, erpBookingServices.preferredEmployeeId))
      .leftJoin(invoices, and(
        eq(invoices.id, erpBookingServices.invoiceId),
        eq(invoices.branchId, erpBookingServices.branchId),
      ))
      .leftJoin(serviceQueueEntries, eq(serviceQueueEntries.invoiceLineId, erpBookingServices.invoiceLineId))
      .where(and(eq(erpBookingServices.branchId, branchId), inArray(erpBookingServices.bookingId, bookingIds)))
      .orderBy(asc(erpBookingServices.id));
    const servicesByBooking = new Map<number, typeof services>();
    for (const service of services) {
      const list = servicesByBooking.get(service.bookingId) ?? [];
      list.push(service);
      servicesByBooking.set(service.bookingId, list);
    }
    const totalsByBooking = await bookingPaymentsTotals(database, branchId, bookingIds);
    return rows.map((row) => {
      const bookingServices = servicesByBooking.get(row.id) ?? [];
      return {
        id: row.id,
        branchId: row.branchId,
        client: { id: row.clientId, fullName: row.clientName, phone: row.clientPhone },
        scheduledAt: row.scheduledAt,
        status: row.status,
        note: row.note,
        money: buildBookingMoney({
          ...(totalsByBooking.get(row.id) ?? { paymentsTotal: 0n, refundsTotal: 0n, appliedTotal: 0n }),
          pendingValueTotal: sumServicePrices(
            bookingServices.filter((service) => service.status === 'pending').map((service) => service.servicePrice),
          ),
        }),
        services: bookingServices.map((service) => ({
          serviceId: service.serviceId,
          serviceName: service.serviceName,
          servicePrice: service.servicePrice,
          preferredEmployee: service.employeeId === null ? null : { id: service.employeeId, name: service.employeeName ?? '' },
          status: service.status,
          invoiceId: service.invoiceId,
          invoiceNumber: service.invoiceNumber,
          queueStatus: service.queueStatus,
        })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  },

  async hasAny(branchId) {
    const row = await database.select({ id: erpBookings.id }).from(erpBookings)
      .where(eq(erpBookings.branchId, branchId)).limit(1);
    return row.length > 0;
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

  // A cancelled service is no longer work for anybody: only services still
  // waiting keep their employee booked for a future date.
  async countFutureForEmployee(employeeId, now) {
    const rows = await database.select({ count: countDistinct(erpBookings.id) }).from(erpBookings)
      .innerJoin(erpBookingServices, eq(erpBookingServices.bookingId, erpBookings.id))
      .where(and(
        eq(erpBookingServices.preferredEmployeeId, employeeId),
        eq(erpBookingServices.status, 'pending'),
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

  async applySale(transaction, input: BookingConversionInput) {
    const scope = and(
      eq(erpBookings.id, input.bookingId),
      eq(erpBookings.branchId, input.branchId),
      eq(erpBookings.clientId, input.clientId),
      eq(erpBookings.status, 'arrived'),
    );
    const booking = (await transaction.select().from(erpBookings).where(scope)
      .for('update').limit(1))[0];
    if (!booking) throw new BookingError('BOOKING_ALREADY_HANDLED');
    // Locking, so the sale sees a service cancelled since this transaction
    // started rather than the snapshot its first read froze.
    const pending = await transaction.select({
      id: erpBookingServices.id,
      serviceId: erpBookingServices.serviceId,
    }).from(erpBookingServices).where(and(
      eq(erpBookingServices.bookingId, input.bookingId),
      eq(erpBookingServices.status, 'pending'),
    )).for('update');
    const pendingByServiceId = new Map(pending.map((row) => [row.serviceId, row.id]));
    // Only booked services sell, each booked unit once, one quantity per service.
    const seen = new Set<number>();
    for (const line of input.services) {
      if (line.quantity !== 1 || !pendingByServiceId.has(line.serviceId) || seen.has(line.serviceId)) {
        throw new BookingError('BOOKING_SERVICE_NOT_FOUND', 'خدمات البيع لا تطابق خدمات الحجز');
      }
      seen.add(line.serviceId);
    }
    if (seen.size === 0) {
      throw new BookingError('BOOKING_SERVICE_NOT_FOUND', 'خدمات البيع لا تطابق خدمات الحجز');
    }
    for (const serviceId of seen) {
      // Addressing the locked row and requiring it to still be pending keeps a
      // cancel that slipped in from being overwritten by this sale.
      const result = await transaction.update(erpBookingServices).set({
        status: 'sold',
        invoiceId: input.invoiceId,
        invoiceLineId: input.services.find((line) => line.serviceId === serviceId)!.invoiceLineId,
        changedAt: input.convertedAt,
      }).where(and(
        eq(erpBookingServices.id, pendingByServiceId.get(serviceId)!),
        eq(erpBookingServices.status, 'pending'),
      ));
      if (result[0].affectedRows !== 1) {
        throw new BookingError('BOOKING_SERVICE_NOT_FOUND', 'خدمات البيع لا تطابق خدمات الحجز');
      }
    }
    // With nothing left pending the booking is spent; otherwise the cashier
    // must still choose keep / move / cancel for the leftovers.
    if (seen.size === pending.length) {
      await transaction.update(erpBookings).set({
        status: 'converted',
        updatedAt: input.convertedAt,
      }).where(scope);
    } else {
      await transaction.update(erpBookings).set({
        updatedAt: input.convertedAt,
      }).where(scope);
    }
    const record = (await hydrate(transaction, input.branchId, input.bookingId))!;
    await audit.record(transaction, {
      module: AUDIT_MODULE,
      action: 'apply-sale',
      entityType: 'booking',
      entityId: input.bookingId,
      beforeState: booking,
      afterState: record,
      relatedIds: { branchId: input.branchId, invoiceId: input.invoiceId },
      createdAt: input.convertedAt,
    });
  },

  async remove(branchId, id) {
    return database.transaction(async (transaction) => {
      const booking = (await transaction.select().from(erpBookings).where(and(
        eq(erpBookings.id, id),
        eq(erpBookings.branchId, branchId),
        inArray(erpBookings.status, ['booked', 'cancelled', 'no_show']),
      )).for('update').limit(1))[0];
      if (!booking) return null;
      // A booking that ever held money or sold a service is part of the books.
      const money = await transaction.select({ id: erpBookingPayments.id })
        .from(erpBookingPayments).where(eq(erpBookingPayments.bookingId, id)).limit(1);
      if (money.length) return null;
      const sold = await transaction.select({ id: erpBookingServices.id })
        .from(erpBookingServices).where(and(
          eq(erpBookingServices.bookingId, id),
          eq(erpBookingServices.status, 'sold'),
        )).limit(1);
      if (sold.length) return null;
      const record = (await hydrate(transaction, branchId, id))!;
      await transaction.delete(erpBookingServices).where(and(
        eq(erpBookingServices.bookingId, id),
        eq(erpBookingServices.branchId, branchId),
      ));
      await transaction.delete(erpBookings).where(and(
        eq(erpBookings.id, id),
        eq(erpBookings.branchId, branchId),
      ));
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'delete',
        entityType: 'booking',
        entityId: id,
        beforeState: booking,
        relatedIds: { branchId },
        createdAt: new Date(),
      });
      return record;
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

  async recordPayment(input: BookingPaymentWrite) {
    return database.transaction(async (transaction) => {
      const findRecorded = (locking: boolean) => {
        const query = transaction.select({
          kind: erpBookingPayments.kind,
          method: erpBookingPayments.method,
          amount: erpBookingPayments.amount,
          cashierSessionId: erpBookingPayments.cashierSessionId,
        }).from(erpBookingPayments).where(and(
          eq(erpBookingPayments.bookingId, input.bookingId),
          eq(erpBookingPayments.operationReference, input.operationReference),
        )).limit(1);
        // A locking read refreshes what the transaction sees; a plain read keeps
        // the stored snapshot and must stay on a path that writes nothing.
        return (locking ? query.for('update') : query).then(([row]) => row ?? null);
      };
      const replay = async (locking: boolean) => {
        const previous = await findRecorded(locking);
        if (!previous) return null;
        // The same reference is the same payment only inside the same drawer: a
        // retry naming another cashier session is a different operation.
        if (previous.kind === 'payment' && previous.method === input.method
          && previous.cashierSessionId === input.cashierSessionId
          && toCents(previous.amount) === toCents(input.amount)) {
          return (await hydrate(transaction, input.branchId, input.bookingId))!;
        }
        throw new BookingError('BOOKING_OPERATION_CONFLICT');
      };
      // Same lock order as the sale transaction: session first, then booking.
      const session = await lockShiftRow(transaction, input);
      if (session) assertShiftOwnedBy(session, input);
      // A retry after the shift closed replays from the ledger and writes
      // nothing, so the pre-lock snapshot it reads is harmless there.
      if (!session || !shiftStillTakesMoney(session, input.at)) {
        const stored = await replay(false);
        if (stored) return stored;
        throw new BookingError('BOOKING_CASHIER_SESSION_NOT_OPEN');
      }
      const booking = (await transaction.select().from(erpBookings).where(and(
        eq(erpBookings.id, input.bookingId),
        eq(erpBookings.branchId, input.branchId),
      )).for('update').limit(1))[0];
      if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
      // The booking lock is held, so this locking read both recognizes a retry
      // and refreshes the ledger the cap below is computed from.
      const stored = await replay(true);
      if (stored) return stored;
      if (booking.status !== 'booked' && booking.status !== 'arrived') {
        throw new BookingError('BOOKING_ALREADY_HANDLED');
      }
      // The cap must be computed from data locked above, so two concurrent
      // cashiers can never push the held money past the pending services' value.
      const services = await transaction.select({ price: erpServices.price })
        .from(erpBookingServices)
        .innerJoin(erpServices, eq(erpServices.id, erpBookingServices.serviceId))
        .where(and(
          eq(erpBookingServices.bookingId, input.bookingId),
          eq(erpBookingServices.status, 'pending'),
        ));
      const totals = (await bookingPaymentsTotals(transaction, input.branchId, [input.bookingId]))
        .get(input.bookingId) ?? { paymentsTotal: 0n, refundsTotal: 0n, appliedTotal: 0n };
      const cap = buildBookingMoney({
        ...totals,
        pendingValueTotal: sumServicePrices(services.map((service) => service.price)),
      });
      if (toCents(input.amount) > toCents(cap.maxPayable)) {
        throw new BookingError('BOOKING_PAYMENT_EXCEEDS_CAP');
      }
      await transaction.insert(erpBookingPayments).values({
        bookingId: input.bookingId,
        branchId: input.branchId,
        kind: 'payment',
        method: input.method,
        amount: input.amount,
        cashierSessionId: input.cashierSessionId,
        actingAccountId: input.actorAccountId,
        operationReference: input.operationReference,
        createdAt: input.at,
      });
      const record = (await hydrate(transaction, input.branchId, input.bookingId))!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'record_payment',
        entityType: 'booking',
        entityId: input.bookingId,
        afterState: record,
        relatedIds: {
          branchId: input.branchId,
          cashierSessionId: input.cashierSessionId,
          method: input.method,
          amount: input.amount,
        },
        createdAt: input.at,
      });
      return record;
    });
  },

  async cancelServices(input) {
    return database.transaction(async (transaction) => {
      // Same lock order as payments: an open shift locks first when money moves.
      // The shift is read without its "still open" filter, because a retry of a
      // cancel must replay even after the shift closed.
      const session = input.refund
        ? await lockShiftRow(transaction, {
          cashierSessionId: input.refund.cashierSessionId,
          branchId: input.branchId,
        })
        : null;
      if (session) assertShiftOwnedBy(session, input);
      const booking = (await transaction.select().from(erpBookings).where(and(
        eq(erpBookings.id, input.bookingId),
        eq(erpBookings.branchId, input.branchId),
      )).for('update').limit(1))[0];
      if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
      const requested = await transaction.select({
        id: erpBookingServices.id,
        status: erpBookingServices.status,
      }).from(erpBookingServices).where(and(
        eq(erpBookingServices.bookingId, input.bookingId),
        inArray(erpBookingServices.serviceId, input.serviceIds),
      )).for('update');
      if (requested.length !== new Set(input.serviceIds).size) {
        throw new BookingError('BOOKING_SERVICE_NOT_FOUND');
      }
      // A replay of the same cancel command is recognized from the services
      // themselves, so it works whether the booking is still waiting or this
      // very cancel is what spent it, and whether or not the shift is still on.
      const allCancelled = requested.every((row) => row.status === 'cancelled');
      if (allCancelled) {
        await assertRefundReplayed(transaction, input.bookingId, input.refund);
        return (await hydrate(transaction, input.branchId, input.bookingId))!;
      }
      if (requested.some((row) => row.status !== 'pending')) {
        throw new BookingError('BOOKING_SERVICE_NOT_FOUND');
      }
      if (input.refund && (!session || !shiftStillTakesMoney(session, input.at))) {
        throw new BookingError('BOOKING_CASHIER_SESSION_NOT_OPEN');
      }
      if (booking.status !== 'booked' && booking.status !== 'arrived') {
        throw new BookingError('BOOKING_ALREADY_HANDLED');
      }
      await transaction.update(erpBookingServices).set({
        status: 'cancelled',
        changedAt: input.at,
      }).where(and(
        eq(erpBookingServices.bookingId, input.bookingId),
        inArray(erpBookingServices.serviceId, input.serviceIds),
      ));
      const totals = (await bookingPaymentsTotals(transaction, input.branchId, [input.bookingId]))
        .get(input.bookingId) ?? { paymentsTotal: 0n, refundsTotal: 0n, appliedTotal: 0n };
      const held = totals.paymentsTotal - totals.refundsTotal - totals.appliedTotal;
      const pendingValue = await pendingValueOf(transaction, input.bookingId);
      const excess = held > pendingValue ? held - pendingValue : 0n;
      if (excess > 0n) {
        if (!input.refund) {
          throw new BookingError('BOOKING_REFUND_REQUIRED', undefined, {
            amount: signedMoney(excess),
          });
        }
        assertRefundCoversExcess(input.refund, excess);
        await insertRefundRows(transaction, {
          bookingId: input.bookingId,
          branchId: input.branchId,
          cause: 'service_cancelled',
          actorAccountId: input.actorAccountId,
          at: input.at,
          refund: input.refund,
        });
      }
      const record = (await hydrate(transaction, input.branchId, input.bookingId))!;
      // The booking is only spent when nothing is left waiting; leftover
      // services stay sellable, cancellable, and movable.
      await transaction.update(erpBookings).set({
        status: record.services.some((service) => service.status === 'pending')
          ? booking.status
          : record.services.some((service) => service.status === 'sold')
            ? 'converted'
            : 'cancelled',
        updatedAt: input.at,
      }).where(eq(erpBookings.id, input.bookingId));
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'cancel-services',
        entityType: 'booking',
        entityId: input.bookingId,
        afterState: (await hydrate(transaction, input.branchId, input.bookingId))!,
        relatedIds: {
          branchId: input.branchId,
          serviceIds: input.serviceIds.join(','),
          ...(input.refund ? { refunded: record.money.refunded } : {}),
        },
        createdAt: input.at,
      });
      return (await hydrate(transaction, input.branchId, input.bookingId))!;
    });
  },

  async finalizeCancellation(input) {
    return database.transaction(async (transaction) => {
      // Read without the "still open" filter so a retry of this cancel replays
      // even when the shift has since closed.
      const session = input.refund
        ? await lockShiftRow(transaction, {
          cashierSessionId: input.refund.cashierSessionId,
          branchId: input.branchId,
        })
        : null;
      if (session) assertShiftOwnedBy(session, input);
      const booking = (await transaction.select().from(erpBookings).where(and(
        eq(erpBookings.id, input.bookingId),
        eq(erpBookings.branchId, input.branchId),
      )).for('update').limit(1))[0];
      if (!booking) return null;
      const services = await transaction.select({ status: erpBookingServices.status })
        .from(erpBookingServices).where(eq(erpBookingServices.bookingId, input.bookingId))
        .for('update');
      // A retry after a dropped connection replays the recorded outcome. The
      // evidence is that a cancellation really happened: nothing is left waiting
      // and something was cancelled. A fully sold booking has no cancelled
      // service, so a mistaken click on it still answers "already handled".
      const alreadyCancelled = services.some((row) => row.status === 'cancelled')
        && services.every((row) => row.status !== 'pending');
      if (alreadyCancelled
        && (booking.status === input.status || booking.status === 'converted')) {
        await assertRefundReplayed(transaction, input.bookingId, input.refund);
        return (await hydrate(transaction, input.branchId, input.bookingId));
      }
      if (booking.status !== 'booked' && booking.status !== 'arrived') {
        throw new BookingError('BOOKING_ALREADY_HANDLED');
      }
      // A no-show can only be recorded once the appointment time has passed,
      // and only for a client who never arrived.
      if (input.status === 'no_show' && (booking.status !== 'booked' || booking.scheduledAt >= input.at)) {
        return null;
      }
      if (input.refund && (!session || !shiftStillTakesMoney(session, input.at))) {
        throw new BookingError('BOOKING_CASHIER_SESSION_NOT_OPEN');
      }
      await transaction.update(erpBookingServices).set({
        status: 'cancelled',
        changedAt: input.at,
      }).where(and(
        eq(erpBookingServices.bookingId, input.bookingId),
        eq(erpBookingServices.status, 'pending'),
      ));
      const totals = (await bookingPaymentsTotals(transaction, input.branchId, [input.bookingId]))
        .get(input.bookingId) ?? { paymentsTotal: 0n, refundsTotal: 0n, appliedTotal: 0n };
      const held = totals.paymentsTotal - totals.refundsTotal - totals.appliedTotal;
      const pendingValue = await pendingValueOf(transaction, input.bookingId);
      const excess = held > pendingValue ? held - pendingValue : 0n;
      if (excess > 0n) {
        if (!input.refund) {
          throw new BookingError('BOOKING_REFUND_REQUIRED', undefined, {
            amount: signedMoney(excess),
          });
        }
        assertRefundCoversExcess(input.refund, excess);
        await insertRefundRows(transaction, {
          bookingId: input.bookingId,
          branchId: input.branchId,
          cause: input.status === 'no_show' ? 'no_show' : 'booking_cancelled',
          actorAccountId: input.actorAccountId,
          at: input.at,
          refund: input.refund,
        });
      }
      const anySold = ((await transaction.select({ id: erpBookingServices.id })
        .from(erpBookingServices).where(and(
          eq(erpBookingServices.bookingId, input.bookingId),
          eq(erpBookingServices.status, 'sold'),
        )).limit(1)).length) > 0;
      const finalStatus = anySold ? 'converted' : input.status;
      await transaction.update(erpBookings).set({
        status: finalStatus,
        updatedAt: input.at,
      }).where(eq(erpBookings.id, input.bookingId));
      const record = (await hydrate(transaction, input.branchId, input.bookingId))!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: input.status === 'no_show' ? 'no-show' : 'cancel',
        entityType: 'booking',
        entityId: input.bookingId,
        beforeState: booking,
        afterState: record,
        relatedIds: { branchId: input.branchId },
        createdAt: input.at,
      });
      return record;
    });
  },

  async reschedule(input) {
    return database.transaction(async (transaction) => {
      const booking = (await transaction.select().from(erpBookings).where(and(
        eq(erpBookings.id, input.bookingId),
        eq(erpBookings.branchId, input.branchId),
        inArray(erpBookings.status, ['booked', 'arrived']),
      )).for('update').limit(1))[0];
      if (!booking) return null;
      await transaction.update(erpBookings).set({
        scheduledAt: input.scheduledAt,
        status: 'booked',
        updatedAt: input.at,
      }).where(eq(erpBookings.id, input.bookingId));
      const record = (await hydrate(transaction, input.branchId, input.bookingId))!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'reschedule',
        entityType: 'booking',
        entityId: input.bookingId,
        beforeState: booking,
        afterState: record,
        relatedIds: { branchId: input.branchId },
        createdAt: input.at,
      });
      return record;
    });
  },
});

import type {
  BookingRefundInput,
  BookingStatus,
  CancelBookingServicesInput,
  CreateBookingInput,
  ListBookingsQuery,
  RecordBookingPaymentInput,
  RescheduleBookingInput,
  UpdateBookingStatusInput,
  UpdateBookingServicePreferenceInput,
} from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import type { SaleTransaction } from '../sales/index.js';
import type { BookingMoneySummary } from './booking-money.js';

export type BookingRecord = {
  id: number;
  branchId: number;
  client: { id: number; fullName: string | null; phone: string | null };
  scheduledAt: Date;
  status: BookingStatus;
  note: string | null;
  money: BookingMoneySummary;
  services: Array<{
    serviceId: number;
    serviceName: string;
    servicePrice: string | null;
    preferredEmployee: { id: number; name: string } | null;
    status: 'pending' | 'sold' | 'cancelled';
    invoiceId: number | null;
    invoiceNumber: string | null;
    queueStatus: 'pending' | 'in_progress' | 'completed' | 'overdue' | 'canceled' | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBookingWrite = {
  branchId: number;
  clientId: number;
  scheduledAt: Date;
  note: string | null;
  actingAccountId: number;
  services: Array<{ serviceId: number; preferredEmployeeId?: number | undefined }>;
  createdAt: Date;
};

export interface BookingRepository {
  create(input: CreateBookingWrite): Promise<BookingRecord>;
  findById(branchId: number, id: number): Promise<BookingRecord | null>;
  listDay(branchId: number, cairoDate: string): Promise<BookingRecord[]>;
  remove(branchId: number, id: number): Promise<BookingRecord | null>;
  hasAny?(branchId: number): Promise<boolean>;
  transition(
    branchId: number,
    id: number,
    from: BookingStatus[],
    to: Exclude<BookingStatus, 'converted'>,
    changedAt: Date,
  ): Promise<BookingRecord | null>;
  countFutureForEmployee(employeeId: number, now: Date): Promise<number>;
  applySale(transaction: SaleTransaction, input: BookingConversionInput): Promise<void>;
  listActiveEmployees(branchId: number): Promise<Array<{ id: number; name: string }>>;
  updatePreference(
    branchId: number,
    bookingId: number,
    serviceId: number,
    employeeId: number | null,
    changedAt: Date,
  ): Promise<BookingRecord | null>;
  recordPayment(input: BookingPaymentWrite): Promise<BookingRecord>;
  cancelServices(input: BookingLeftoverWrite & { serviceIds: number[] }): Promise<BookingRecord>;
  finalizeCancellation(
    input: BookingLeftoverWrite & { status: 'cancelled' | 'no_show' },
  ): Promise<BookingRecord | null>;
  reschedule(input: {
    bookingId: number;
    branchId: number;
    scheduledAt: Date;
    at: Date;
  }): Promise<BookingRecord | null>;
}

export type BookingRefundWrite = {
  cashierSessionId: number;
  payments: Array<BookingRefundInput['payments'][number]>;
  operationReference: string;
};

export type BookingLeftoverWrite = {
  bookingId: number;
  branchId: number;
  actorAccountId: number;
  actorRole: 'admin' | 'cashier';
  refund?: BookingRefundWrite | undefined;
  at: Date;
};

export type BookingPaymentWrite = {
  bookingId: number;
  branchId: number;
  cashierSessionId: number;
  actorAccountId: number;
  actorRole: 'admin' | 'cashier';
  method: RecordBookingPaymentInput['method'];
  amount: string;
  operationReference: string;
  at: Date;
};

export type BookingConversionInput = {
  bookingId: number;
  branchId: number;
  clientId: number;
  invoiceId: number;
  services: Array<{ serviceId: number; invoiceLineId: number; quantity: number }>;
  convertedAt: Date;
};

export type BookingErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_ALREADY_HANDLED'
  | 'BOOKING_CLIENT_NOT_FOUND'
  | 'BOOKING_SERVICE_NOT_FOUND'
  | 'BOOKING_EMPLOYEE_NOT_FOUND'
  | 'BOOKING_CASHIER_SESSION_NOT_OPEN'
  | 'BOOKING_PAYMENT_EXCEEDS_CAP'
  | 'BOOKING_OPERATION_CONFLICT'
  | 'BOOKING_REFUND_REQUIRED'
  | 'BOOKING_REFUND_AMOUNT_MISMATCH';


const messages: Record<BookingErrorCode, string> = {
  BOOKING_NOT_FOUND: 'الحجز غير موجود',
  BOOKING_ALREADY_HANDLED: 'هذا الحجز يتم التعامل معه بالفعل أو انتهى',
  BOOKING_CLIENT_NOT_FOUND: 'العميل غير موجود في هذا الفرع',
  BOOKING_SERVICE_NOT_FOUND: 'إحدى الخدمات غير متاحة في هذا الفرع',
  BOOKING_EMPLOYEE_NOT_FOUND: 'الموظف المفضل غير متاح في هذا الفرع',
  BOOKING_CASHIER_SESSION_NOT_OPEN: 'لا توجد وردية مفتوحة صالحة لهذا الفرع',
  BOOKING_PAYMENT_EXCEEDS_CAP: 'المبلغ يتجاوز الحد المتبقي من قيمة خدمات الحجز',
  BOOKING_OPERATION_CONFLICT: 'تم استخدام مرجع العملية مسبقاً بتفاصيل مختلفة',
  BOOKING_REFUND_REQUIRED: 'يجب رد المبلغ الزائد للعميل من الدرج',
  BOOKING_REFUND_AMOUNT_MISMATCH: 'مبلغ الرد لا يطابق المبلغ المستحق للعميل',
};

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message = messages[code],
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

const allowedFrom: Record<UpdateBookingStatusInput['status'], BookingStatus[]> = {
  arrived: ['booked'],
  booked: ['arrived'],
  cancelled: ['booked', 'arrived'],
  no_show: ['booked'],
};

export const createBookingService = (dependencies: {
  repository: BookingRepository;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const { repository, resolveBranchContext } = dependencies;
  return {
    async create(actor: ErpAccountIdentity, input: CreateBookingInput) {
      const { branchId, accountId } = await resolveBranchContext(actor, input.branchId);
      const now = new Date();
      return repository.create({
        branchId,
        clientId: input.clientId,
        scheduledAt: new Date(input.scheduledAt),
        note: input.note ?? null,
        actingAccountId: accountId,
        services: input.services,
        createdAt: now,
      });
    },

    async get(actor: ErpAccountIdentity, id: number, requestedBranchId?: number) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      const booking = await repository.findById(branchId, id);
      if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
      return booking;
    },

    async listDay(actor: ErpAccountIdentity, query: ListBookingsQuery) {
      const { branchId } = await resolveBranchContext(actor, query.branchId);
      return repository.listDay(branchId, query.date);
    },

    async hasAny(actor: ErpAccountIdentity, requestedBranchId?: number) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      return repository.hasAny ? repository.hasAny(branchId) : false;
    },

    async listEmployeeOptions(actor: ErpAccountIdentity, requestedBranchId?: number) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      return repository.listActiveEmployees(branchId);
    },

    async updateStatus(
      actor: ErpAccountIdentity,
      id: number,
      input: UpdateBookingStatusInput & { branchId?: number | undefined },
    ) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      if (input.status === 'cancelled' || input.status === 'no_show') {
        // Cancelling (or a no-show) spends every pending service and hands back
        // any held money beyond what remains, out of an open shift's drawer.
        const booking = await repository.finalizeCancellation({
          bookingId: id,
          branchId,
          status: input.status,
          actorAccountId: actor.accountId,
          actorRole: actor.role,
          ...(input.refund ? { refund: input.refund } : {}),
          at: new Date(),
        });
        if (!booking) throw new BookingError('BOOKING_ALREADY_HANDLED');
        return booking;
      }
      const booking = await repository.transition(
        branchId,
        id,
        allowedFrom[input.status],
        input.status,
        new Date(),
      );
      if (!booking) throw new BookingError('BOOKING_ALREADY_HANDLED');
      return booking;
    },

    async cancelServices(actor: ErpAccountIdentity, bookingId: number, input: CancelBookingServicesInput) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      return repository.cancelServices({
        bookingId,
        branchId,
        serviceIds: input.serviceIds,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        ...(input.refund ? { refund: input.refund } : {}),
        at: new Date(),
      });
    },

    async reschedule(actor: ErpAccountIdentity, bookingId: number, input: RescheduleBookingInput) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      const booking = await repository.reschedule({
        bookingId,
        branchId,
        scheduledAt: new Date(input.scheduledAt),
        at: new Date(),
      });
      if (!booking) throw new BookingError('BOOKING_ALREADY_HANDLED');
      return booking;
    },

    async updatePreference(
      actor: ErpAccountIdentity,
      bookingId: number,
      serviceId: number,
      input: UpdateBookingServicePreferenceInput,
    ) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      const booking = await repository.updatePreference(
        branchId, bookingId, serviceId, input.preferredEmployeeId, new Date(),
      );
      if (!booking) throw new BookingError('BOOKING_ALREADY_HANDLED');
      return booking;
    },

    async recordPayment(actor: ErpAccountIdentity, bookingId: number, input: RecordBookingPaymentInput) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      return repository.recordPayment({
        bookingId,
        branchId,
        cashierSessionId: input.cashierSessionId,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        method: input.method,
        amount: input.amount,
        operationReference: input.operationReference,
        at: new Date(),
      });
    },

    async remove(
      actor: ErpAccountIdentity,
      id: number,
      requestedBranchId?: number,
    ) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      const existing = await repository.findById(branchId, id);
      if (!existing) throw new BookingError('BOOKING_NOT_FOUND');
      if (!['booked', 'cancelled', 'no_show'].includes(existing.status)) {
        throw new BookingError('BOOKING_ALREADY_HANDLED');
      }
      const deleted = await repository.remove(branchId, id);
      if (!deleted) throw new BookingError('BOOKING_ALREADY_HANDLED');
      return deleted;
    },

    countFutureForEmployee(employeeId: number, now = new Date()) {
      return repository.countFutureForEmployee(employeeId, now);
    },
  };
};

export type BookingService = ReturnType<typeof createBookingService>;

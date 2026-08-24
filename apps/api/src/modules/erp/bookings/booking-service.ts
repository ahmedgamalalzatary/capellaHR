import type {
  BookingStatus,
  CreateBookingInput,
  ListBookingsQuery,
  UpdateBookingStatusInput,
  UpdateBookingServicePreferenceInput,
} from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import type { SaleTransaction } from '../sales/index.js';

export type BookingRecord = {
  id: number;
  branchId: number;
  client: { id: number; fullName: string | null; phone: string | null };
  scheduledAt: Date;
  status: BookingStatus;
  note: string | null;
  invoiceId: number | null;
  services: Array<{
    serviceId: number;
    serviceName: string;
    servicePrice: string | null;
    preferredEmployee: { id: number; name: string } | null;
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
  transition(
    branchId: number,
    id: number,
    from: BookingStatus[],
    to: Exclude<BookingStatus, 'converted'>,
    changedAt: Date,
  ): Promise<BookingRecord | null>;
  countFutureForEmployee(employeeId: number, now: Date): Promise<number>;
  convert(transaction: SaleTransaction, input: BookingConversionInput): Promise<void>;
  listActiveEmployees(branchId: number): Promise<Array<{ id: number; name: string }>>;
  updatePreference(
    branchId: number,
    bookingId: number,
    serviceId: number,
    employeeId: number | null,
    changedAt: Date,
  ): Promise<BookingRecord | null>;
}

export type BookingConversionInput = {
  bookingId: number;
  branchId: number;
  clientId: number;
  invoiceId: number;
  serviceIds: number[];
  convertedAt: Date;
};

export type BookingErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_ALREADY_HANDLED'
  | 'BOOKING_CLIENT_NOT_FOUND'
  | 'BOOKING_SERVICE_NOT_FOUND'
  | 'BOOKING_EMPLOYEE_NOT_FOUND';
  

const messages: Record<BookingErrorCode, string> = {
  BOOKING_NOT_FOUND: 'الحجز غير موجود',
  BOOKING_ALREADY_HANDLED: 'هذا الحجز يتم التعامل معه بالفعل أو انتهى',
  BOOKING_CLIENT_NOT_FOUND: 'العميل غير موجود في هذا الفرع',
  BOOKING_SERVICE_NOT_FOUND: 'إحدى الخدمات غير متاحة في هذا الفرع',
  BOOKING_EMPLOYEE_NOT_FOUND: 'الموظف المفضل غير متاح في هذا الفرع',
};

export class BookingError extends Error {
  constructor(public readonly code: BookingErrorCode, message = messages[code]) {
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

    countFutureForEmployee(employeeId: number, now = new Date()) {
      return repository.countFutureForEmployee(employeeId, now);
    },
  };
};

export type BookingService = ReturnType<typeof createBookingService>;

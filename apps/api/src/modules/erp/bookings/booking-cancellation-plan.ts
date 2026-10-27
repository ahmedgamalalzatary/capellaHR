import type { createDatabase } from '@capella/database';
import { allocateReversalAmounts, hydrateInvoice, signedMoney, toCents } from '../sales/index.js';
import { BookingError, type BookingRecord } from './booking-service.js';

type Database = ReturnType<typeof createDatabase>;
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export const bookingServiceCanCancel = (service: BookingRecord['services'][number]) => service.status === 'pending'
  || (service.status === 'sold' && service.queueStatus !== null && !['completed', 'canceled'].includes(service.queueStatus));

export async function planBookingCancellation(executor: Executor, booking: BookingRecord, requestedIds?: number[]) {
  const selected = booking.services.filter((service) => bookingServiceCanCancel(service)
    && (requestedIds === undefined || requestedIds.includes(service.serviceId)));
  if (selected.length === 0 || (requestedIds && selected.length !== requestedIds.length)) throw new BookingError('BOOKING_ALREADY_HANDLED');
  const remaining = booking.services.filter((service) => service.status === 'pending' && !selected.includes(service))
    .reduce((sum, service) => sum + toCents(service.servicePrice ?? '0.00'), 0n);
  const held = toCents(booking.money.held);
  const heldRefund = held > remaining ? held - remaining : 0n;
  const invoicePlans = [];
  const ids = [...new Set(selected.flatMap((service) => service.invoiceId === null ? [] : [service.invoiceId]))].sort((a, b) => a - b);
  for (const id of ids) {
    const invoice = await hydrateInvoice(executor, id);
    if (!invoice || invoice.branchId !== booking.branchId) throw new BookingError('BOOKING_ALREADY_HANDLED');
    const services = selected.filter((service) => service.invoiceId === id);
    const lines = services.map((service) => {
      const line = invoice.lines.find((line) => line.itemType === 'service' && line.sourceId === service.serviceId && line.refundableQuantity > 0);
      if (!line) throw new BookingError('BOOKING_ALREADY_HANDLED');
      return { invoiceLineId: line.id, quantity: 1 };
    });
    const allocation = allocateReversalAmounts({
      lines: invoice.lines.map((line) => ({ invoiceLineId: line.id, quantity: line.quantity, unitPrice: line.unitPrice, refundedQuantity: line.refundedQuantity })),
      selected: lines, discountAmount: invoice.totals.discountAmount, taxAmount: invoice.totals.taxAmount,
    });
    const payout = toCents(allocation.total) > toCents(invoice.totals.balanceDue) ? toCents(allocation.total) - toCents(invoice.totals.balanceDue) : 0n;
    invoicePlans.push({ invoiceId: id, lines, payout });
  }
  return {
    serviceIds: selected.map((service) => service.serviceId),
    pendingIds: selected.filter((service) => service.status === 'pending').map((service) => service.serviceId),
    invoicePlans, heldRefund,
    amount: signedMoney(heldRefund + invoicePlans.reduce((sum, invoice) => sum + invoice.payout, 0n)),
  };
}

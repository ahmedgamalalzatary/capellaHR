import { type createDatabase } from '@capella/database';
import { erpBookingPayments, erpBookingServices, erpServices, invoicePayments } from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';

import { signedMoney, toCents } from '../sales/index.js';

export type BookingMoneySummary = {
  paid: string;
  refunded: string;
  applied: string;
  held: string;
  pendingValue: string;
  maxPayable: string;
  excess: string;
};

export const emptyBookingMoney = (pendingValue = '0.00'): BookingMoneySummary => ({
  paid: '0.00',
  refunded: '0.00',
  applied: '0.00',
  held: '0.00',
  pendingValue,
  maxPayable: pendingValue,
  excess: '0.00',
});

/**
 * Single source of truth for booking money, derived — never stored:
 * held = paid − refunded − applied; the cap is the pending services' current
 * value minus what we already hold. Open-price services count as zero.
 */
export const buildBookingMoney = (input: {
  paymentsTotal: bigint;
  refundsTotal: bigint;
  appliedTotal: bigint;
  pendingValueTotal: bigint;
}): BookingMoneySummary => {
  const held = input.paymentsTotal - input.refundsTotal - input.appliedTotal;
  return {
    paid: signedMoney(input.paymentsTotal),
    refunded: signedMoney(input.refundsTotal),
    applied: signedMoney(input.appliedTotal),
    held: signedMoney(held),
    pendingValue: signedMoney(input.pendingValueTotal),
    maxPayable: signedMoney(input.pendingValueTotal > held ? input.pendingValueTotal - held : 0n),
    excess: signedMoney(held > input.pendingValueTotal ? held - input.pendingValueTotal : 0n),
  };
};

export const sumServicePrices = (prices: Array<string | null>) => prices.reduce(
  (total, price) => (price === null ? total : total + toCents(price)),
  0n,
);

type Database = ReturnType<typeof createDatabase>;
type CreditExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The up-front money context a sale settles against: what the booking still
 * holds and what its pending services are currently worth. Read under the
 * booking's own lock so the credit can never overspend the held balance.
 */
export const readBookingCreditContext = async (
  executor: CreditExecutor,
  bookingId: number,
): Promise<{ heldCents: bigint; pendingValueCents: bigint }> => {
  const [ledger] = await executor.select({
    payments: sql<string>`coalesce(sum(case when ${erpBookingPayments.kind} = 'payment' then ${erpBookingPayments.amount} else 0 end), 0)`,
    refunds: sql<string>`coalesce(sum(case when ${erpBookingPayments.kind} = 'refund' then ${erpBookingPayments.amount} else 0 end), 0)`,
  }).from(erpBookingPayments).where(eq(erpBookingPayments.bookingId, bookingId));
  const [applied] = await executor.select({
    total: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)`,
  }).from(invoicePayments).where(eq(invoicePayments.bookingId, bookingId));
  const pending = await executor.select({ price: erpServices.price })
    .from(erpBookingServices)
    .innerJoin(erpServices, eq(erpServices.id, erpBookingServices.serviceId))
    .where(and(
      eq(erpBookingServices.bookingId, bookingId),
      eq(erpBookingServices.status, 'pending'),
    ));
  const heldCents = toCents(ledger?.payments ?? '0.00')
    - toCents(ledger?.refunds ?? '0.00')
    - toCents(applied?.total ?? '0.00');
  return {
    heldCents: heldCents < 0n ? 0n : heldCents,
    pendingValueCents: sumServicePrices(pending.map((service) => service.price)),
  };
};

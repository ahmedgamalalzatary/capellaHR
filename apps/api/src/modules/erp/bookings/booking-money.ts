import { type createDatabase } from '@capella/database';
import { erpBookingPayments, erpBookingServices, erpServices, invoicePayments } from '@capella/database/schema';
import { and, asc, eq, like, or, sql } from 'drizzle-orm';

import type { PaymentMethod } from '@capella/contracts';

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
 * One ledger row per payment method; the operation reference identifies the
 * command and the suffix keeps the per-row uniqueness intact.
 */
export const bookingRefundRowReference = (reference: string, index: number) => (
  index === 0 ? reference : `${reference.slice(0, 33)}-${index + 1}`
);

/**
 * The money a booking sale did not use, handed back in that same sale. A
 * checkout discount or a price change can leave the booking holding more than
 * its invoice is worth, and a fully sold booking has no other refund path — so
 * it must go back here or the shift could never be closed by hand.
 */
export const recordBookingCheckoutExcessRefund = async (
  executor: CreditExecutor,
  input: {
    bookingId: number;
    branchId: number;
    cashierSessionId: number;
    actingAccountId: number;
    at: Date;
    /** The sale's own idempotency key, so a replay can find these rows again. */
    operationReference: string;
    payments: Array<{ method: PaymentMethod; amount: string }>;
  },
) => {
  await executor.insert(erpBookingPayments).values(input.payments.map((payment, index) => ({
    bookingId: input.bookingId,
    branchId: input.branchId,
    kind: 'refund' as const,
    method: payment.method,
    amount: payment.amount,
    refundCause: 'checkout_excess' as const,
    cashierSessionId: input.cashierSessionId,
    actingAccountId: input.actingAccountId,
    operationReference: bookingRefundRowReference(input.operationReference, index),
    createdAt: input.at,
  })));
};

/**
 * The checkout-excess refunds one sale recorded, rebuilt in the order they were
 * written so a replay of the same command compares equal.
 */
export const readBookingCheckoutExcessRefund = async (
  executor: CreditExecutor,
  input: { bookingId: number; operationReference: string },
): Promise<Array<{ method: PaymentMethod; amount: string }>> => {
  const rows = await executor.select({
    method: erpBookingPayments.method,
    amount: erpBookingPayments.amount,
  }).from(erpBookingPayments).where(and(
    eq(erpBookingPayments.bookingId, input.bookingId),
    eq(erpBookingPayments.kind, 'refund'),
    eq(erpBookingPayments.refundCause, 'checkout_excess'),
    or(
      eq(erpBookingPayments.operationReference, input.operationReference),
      like(erpBookingPayments.operationReference, `${input.operationReference.slice(0, 33)}-%`),
    ),
  )).orderBy(asc(erpBookingPayments.id));
  return rows.map(({ method, amount }) => ({ method, amount }));
};

/**
 * The up-front money context a sale settles against: what the booking still
 * holds and what its pending services are currently worth. Read under the
 * booking's own lock so the credit can never overspend the held balance.
 */
export const readBookingCreditContext = async (
  executor: CreditExecutor,
  bookingId: number,
  /** Services this sale is selling; what stays pending after it excludes them. */
  sellingServiceIds: number[] = [],
): Promise<{ heldCents: bigint; pendingValueCents: bigint; leftoverValueCents: bigint }> => {
  const [ledger] = await executor.select({
    payments: sql<string>`coalesce(sum(case when ${erpBookingPayments.kind} = 'payment' then ${erpBookingPayments.amount} else 0 end), 0)`,
    refunds: sql<string>`coalesce(sum(case when ${erpBookingPayments.kind} = 'refund' then ${erpBookingPayments.amount} else 0 end), 0)`,
  }).from(erpBookingPayments).where(eq(erpBookingPayments.bookingId, bookingId));
  const [applied] = await executor.select({
    total: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)`,
  }).from(invoicePayments).where(eq(invoicePayments.bookingId, bookingId));
  const pending = await executor.select({
    serviceId: erpBookingServices.serviceId,
    price: erpServices.price,
  })
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
    leftoverValueCents: sumServicePrices(pending
      .filter((service) => !sellingServiceIds.includes(service.serviceId))
      .map((service) => service.price)),
  };
};

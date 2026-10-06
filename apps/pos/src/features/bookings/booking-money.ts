import type { BookingDto, PaymentMethod } from '@capella/contracts';

export const bookingPaymentMethods: Array<{ method: PaymentMethod; label: string }> = [
  { method: 'cash', label: 'نقدي' },
  { method: 'visa', label: 'فيزا' },
  { method: 'instapay', label: 'إنستا باي' },
  { method: 'vodafone_cash', label: 'فودافون كاش' },
];

export type RefundSplit = Record<PaymentMethod, string>;

export const emptyRefundSplit = (): RefundSplit => ({
  cash: '', visa: '', instapay: '', vodafone_cash: '',
});

const cents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

const text = (value: bigint) => (
  `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`
);

const atLeastZero = (value: bigint) => (value > BigInt(0) ? value : BigInt(0));

type BookingMoneyView = Pick<BookingDto, 'money'> & {
  services: Array<Pick<BookingDto['services'][number], 'serviceId' | 'servicePrice' | 'status'>>;
};

/** What the still-pending services are worth, skipping the given ones; open prices count as 0. */
const pendingValueWithout = (booking: BookingMoneyView, serviceIds: number[]) => (
  booking.services
    .filter((service) => service.status === 'pending' && !serviceIds.includes(service.serviceId))
    .reduce((sum, service) => sum + (cents(service.servicePrice ?? '0') ?? BigInt(0)), BigInt(0))
);

/**
 * The held money handed back when these pending services are cancelled: whatever
 * the services left waiting no longer cover. The server computes the same and
 * refuses any other amount.
 */
export const excessAfterCancelling = (booking: BookingMoneyView, serviceIds: number[]) => (
  text(atLeastZero((cents(booking.money.held) ?? BigInt(0)) - pendingValueWithout(booking, serviceIds)))
);

/**
 * Held money is used first at checkout, up to the invoice total. What is still
 * held afterwards stays only while it covers the services left waiting; the rest
 * goes back to the client in the same sale.
 */
export const bookingCheckout = (
  booking: BookingMoneyView,
  invoiceTotal: string,
  soldServiceIds: number[],
) => {
  const held = cents(booking.money.held) ?? BigInt(0);
  const total = cents(invoiceTotal) ?? BigInt(0);
  const credit = held < total ? held : total;
  return {
    credit: text(credit),
    excess: text(atLeastZero(held - credit - pendingValueWithout(booking, soldServiceIds))),
  };
};

/** The refund rows to send, or null until they add up exactly to the amount owed. */
export const refundPaymentsFor = (split: RefundSplit, amount: string) => {
  const owed = cents(amount);
  const rows: Array<{ method: PaymentMethod; amount: string }> = [];
  let sum = BigInt(0);
  for (const { method } of bookingPaymentMethods) {
    const entered = split[method].trim();
    if (!entered) continue;
    const value = cents(entered);
    if (value === null) return null;
    if (value === BigInt(0)) continue;
    rows.push({ method, amount: text(value) });
    sum += value;
  }
  return owed !== null && rows.length > 0 && sum === owed ? rows : null;
};

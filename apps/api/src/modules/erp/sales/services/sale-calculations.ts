export type SaleAdjustment = {
  kind: 'percentage' | 'fixed';
  value: string;
};

export class MoneyCalculationError extends Error {
  constructor(
    public readonly code:
      | 'DISCOUNT_EXCEEDS_SUBTOTAL'
      | 'TOTAL_NOT_POSITIVE'
      | 'MONEY_OUT_OF_RANGE',
  ) {
    super(code);
    this.name = 'MoneyCalculationError';
  }
}

const toCents = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

const MAX_STORED_MONEY_CENTS = 99_999_999_999_999n;

const assertStoredMoney = (value: bigint) => {
  if (value < 0n || value > MAX_STORED_MONEY_CENTS) {
    throw new MoneyCalculationError('MONEY_OUT_OF_RANGE');
  }
  return value;
};

const fromCents = (value: bigint) => {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
};

export const sumMoney = (values: string[]) => fromCents(
  values.reduce((sum, value) => sum + toCents(value), 0n),
);

const percentageCents = (base: string, percentage: string) => (
  (toCents(base) * toCents(percentage) + 5_000n) / 10_000n
);

export const calculateAdjustment = (base: string, adjustment: SaleAdjustment) => (
  fromCents(adjustment.kind === 'fixed'
    ? toCents(adjustment.value)
    : percentageCents(base, adjustment.value))
);

export const calculateCommission = (base: string, rate: string) => (
  fromCents(percentageCents(base, rate))
);

export const calculateLineTotal = (unitPrice: string, quantity: number) => (
  fromCents(assertStoredMoney(toCents(unitPrice) * BigInt(quantity)))
);

export const calculateSaleTotals = (input: {
  lineTotals: string[];
  discount?: SaleAdjustment | undefined;
  tax?: SaleAdjustment | undefined;
  payments: Array<{ amount: string }>;
}) => {
  const subtotalCents = assertStoredMoney(
    input.lineTotals.reduce((sum, value) => sum + toCents(value), 0n),
  );
  const subtotal = fromCents(subtotalCents);
  const discountAmount = input.discount
    ? calculateAdjustment(subtotal, input.discount)
    : '0.00';
  const taxAmount = input.tax ? calculateAdjustment(subtotal, input.tax) : '0.00';
  const discountCents = toCents(discountAmount);
  if (discountCents > subtotalCents) {
    throw new MoneyCalculationError('DISCOUNT_EXCEEDS_SUBTOTAL');
  }
  const totalCents = subtotalCents - discountCents + toCents(taxAmount);
  if (totalCents <= 0n) throw new MoneyCalculationError('TOTAL_NOT_POSITIVE');
  assertStoredMoney(totalCents);
  const paymentTotalCents = assertStoredMoney(input.payments.reduce(
    (sum, payment) => sum + toCents(payment.amount),
    0n,
  ));

  return {
    subtotal,
    discountAmount,
    taxAmount,
    total: fromCents(totalCents),
    paymentTotal: fromCents(paymentTotalCents),
  };
};

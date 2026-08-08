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

const proportionalCents = (amount: bigint, part: bigint, whole: bigint) => (
  (amount * part + whole / 2n) / whole
);

export const allocateReversalAmounts = (input: {
  lines: Array<{
    invoiceLineId: number;
    quantity: number;
    unitPrice: string;
    refundedQuantity: number;
  }>;
  selected: Array<{ invoiceLineId: number; quantity: number }>;
  discountAmount: string;
  taxAmount: string;
}) => {
  const subtotal = input.lines.reduce(
    (sum, line) => sum + toCents(line.unitPrice) * BigInt(line.quantity),
    0n,
  );
  const discount = toCents(input.discountAmount);
  const tax = toCents(input.taxAmount);
  let grossPrefix = 0n;
  const allocations = new Map<number, { discount: bigint; tax: bigint }>();

  for (const line of input.lines) {
    const lineGross = toCents(line.unitPrice) * BigInt(line.quantity);
    const nextPrefix = grossPrefix + lineGross;
    allocations.set(line.invoiceLineId, {
      discount: proportionalCents(discount, nextPrefix, subtotal)
        - proportionalCents(discount, grossPrefix, subtotal),
      tax: proportionalCents(tax, nextPrefix, subtotal)
        - proportionalCents(tax, grossPrefix, subtotal),
    });
    grossPrefix = nextPrefix;
  }

  const lines = input.selected.map((selected) => {
    const original = input.lines.find((line) => line.invoiceLineId === selected.invoiceLineId);
    if (!original || selected.quantity < 1
      || original.refundedQuantity + selected.quantity > original.quantity) {
      throw new MoneyCalculationError('MONEY_OUT_OF_RANGE');
    }
    const allocated = allocations.get(selected.invoiceLineId)!;
    const startQuantity = BigInt(original.refundedQuantity);
    const endQuantity = startQuantity + BigInt(selected.quantity);
    const originalQuantity = BigInt(original.quantity);
    const lineDiscount = proportionalCents(allocated.discount, endQuantity, originalQuantity)
      - proportionalCents(allocated.discount, startQuantity, originalQuantity);
    const lineTax = proportionalCents(allocated.tax, endQuantity, originalQuantity)
      - proportionalCents(allocated.tax, startQuantity, originalQuantity);
    const lineGross = toCents(original.unitPrice) * BigInt(selected.quantity);
    return {
      invoiceLineId: selected.invoiceLineId,
      quantity: selected.quantity,
      grossAmount: fromCents(lineGross),
      discountAmount: fromCents(lineDiscount),
      taxAmount: fromCents(lineTax),
      total: fromCents(lineGross - lineDiscount + lineTax),
    };
  });
  const sum = (field: 'grossAmount' | 'discountAmount' | 'taxAmount' | 'total') => (
    sumMoney(lines.map((line) => line[field]))
  );
  return {
    lines,
    grossAmount: sum('grossAmount'),
    discountAmount: sum('discountAmount'),
    taxAmount: sum('taxAmount'),
    total: sum('total'),
  };
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

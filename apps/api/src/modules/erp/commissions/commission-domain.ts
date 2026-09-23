const toCents = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};

const fromCents = (cents: bigint) => {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

/** Net earned commission after payouts and commission debt carried into this month. */
export const availableCommission = (netAmount: string, paidAmount: string, debtAmount = '0.00') =>
  fromCents(toCents(netAmount) - toCents(paidAmount) - toCents(debtAmount));

export const carriedCommissionDebt = (
  startingDebt: string,
  months: Array<{ net: string; paid: string; reversals: string }>,
) => {
  let debt = toCents(startingDebt);
  for (const month of months) {
    debt += toCents(month.paid) + toCents(month.reversals) - toCents(month.net);
    if (debt < 0n) debt = 0n;
  }
  return fromCents(debt);
};

export const canPayCommission = (availableAmount: string, amount: string) => {
  const available = toCents(availableAmount);
  const requested = toCents(amount);
  return requested > 0n && requested <= available;
};

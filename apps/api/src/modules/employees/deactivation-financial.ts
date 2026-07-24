const cents = (amount: string) => {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -value : value;
};

export const formatCents = (value: bigint) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

export const projectDeactivationBalance = (
  currentNetSalary: string,
  unpaidAdvanceAmount: string,
  currentMonthAdvanceAmount: string,
) => {
  const projected = cents(currentNetSalary)
    - (cents(unpaidAdvanceAmount) - cents(currentMonthAdvanceAmount));
  return {
    projectedNetSalary: formatCents(projected),
    amountOwed: formatCents(projected < 0n ? -projected : 0n),
  };
};

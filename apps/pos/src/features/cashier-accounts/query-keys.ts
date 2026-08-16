/** Keeps cashier-account and roster lists under one feature-owned cache root. */
export const cashierAccountQueryKeys = {
  all: ['cashier-accounts'] as const,
  list: <T extends object>(filters: T) => ['cashier-accounts', 'list', filters] as const,
  roster: (branchId: number) => ['cashier-accounts', 'roster', branchId] as const,
};

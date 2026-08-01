/** Keeps cashier-account lists under one feature-owned cache root. */
export const cashierAccountQueryKeys = {
  all: ['cashier-accounts'] as const,
  list: <T extends object>(filters: T) => ['cashier-accounts', 'list', filters] as const,
};

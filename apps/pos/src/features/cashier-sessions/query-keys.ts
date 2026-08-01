export const cashierSessionQueryKeys = {
  all: ['cashier-sessions'] as const,
  current: (branchId?: number) => ['cashier-sessions', 'current', branchId ?? 'cashier'] as const,
  branches: ['cashier-sessions', 'branches'] as const,
};

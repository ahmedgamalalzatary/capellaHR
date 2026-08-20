export const cashierSessionQueryKeys = {
  all: ['cashier-sessions'] as const,
  current: (branchId?: number) => ['cashier-sessions', 'current', branchId ?? 'cashier'] as const,
  branches: ['cashier-sessions', 'branches'] as const,
  list: (branchId: number | undefined, page: number) => (
    ['cashier-sessions', 'list', branchId ?? 'cashier', page] as const
  ),
  summary: (sessionId: number) => ['cashier-sessions', 'summary', sessionId] as const,
  detail: (sessionId: number) => ['cashier-sessions', 'detail', sessionId] as const,
};

export const salesQueryKeys = {
  all: ['erp-sales'] as const,
  quote: (draft: unknown) => ['erp-sales', 'quote', draft] as const,
  visits: (clientId: number, branchId?: number) => (
    ['erp-sales', 'client-visits', clientId, branchId ?? null] as const
  ),
};

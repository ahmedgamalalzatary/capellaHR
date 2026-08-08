export const salesQueryKeys = {
  all: ['erp-sales'] as const,
  quote: (draft: unknown) => ['erp-sales', 'quote', draft] as const,
  visits: (clientId: number, branchId?: number) => (
    ['erp-sales', 'client-visits', clientId, branchId ?? null] as const
  ),
  invoices: (branchId: number | undefined, page: number, search?: string) => (
    ['erp-sales', 'invoices', branchId ?? null, page, search ?? null] as const
  ),
  invoice: (invoiceId: number, branchId?: number) => (
    ['erp-sales', 'invoice', invoiceId, branchId ?? null] as const
  ),
};

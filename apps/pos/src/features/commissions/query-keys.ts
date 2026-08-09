export const commissionQueryKeys = {
  all: ['erp-commissions'] as const,
  list: (filters: object) => ['erp-commissions', 'list', filters] as const,
  detail: (employeeId: number, month: string, branchId: number) => (
    ['erp-commissions', 'detail', employeeId, month, branchId] as const
  ),
};

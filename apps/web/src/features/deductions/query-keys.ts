/** Keeps all deduction cache reads and invalidations under one feature-owned root. */
export const deductionQueryKeys = {
  all: ['deductions'] as const,
  list: (filters: object) => ['deductions', 'list', filters] as const,
};

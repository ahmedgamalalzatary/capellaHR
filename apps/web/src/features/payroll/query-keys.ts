/** Keeps all payroll cache reads and invalidations under one feature-owned root. */
export const payrollQueryKeys = {
  all: ['payroll'] as const,
  list: <T extends object>(filters: T) => ['payroll', 'list', filters] as const,
};

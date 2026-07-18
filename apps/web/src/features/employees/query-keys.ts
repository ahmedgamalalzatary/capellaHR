/** Keeps all employee cache reads and invalidations under one feature-owned root. */
export const employeeQueryKeys = {
  all: ['employees'] as const,
  list: <T extends object>(filters: T) => ['employees', 'list', filters] as const,
  options: () => ['employees', 'options'] as const,
};

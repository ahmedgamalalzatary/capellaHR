/** Keeps all branch cache reads and invalidations under one feature-owned root. */
export const branchQueryKeys = {
  all: ['branches'] as const,
  list: <T extends object>(filters: T) => ['branches', 'list', filters] as const,
  options: () => ['branches', 'options'] as const,
};

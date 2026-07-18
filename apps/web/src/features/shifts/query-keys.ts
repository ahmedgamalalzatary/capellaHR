/** Keeps all shift cache reads and invalidations under one feature-owned root. */
export const shiftQueryKeys = {
  all: ['shifts'] as const,
  list: <T extends object>(filters: T) => ['shifts', 'list', filters] as const,
};

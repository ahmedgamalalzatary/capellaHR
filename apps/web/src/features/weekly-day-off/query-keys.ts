/** Keeps all weekly-day-off cache reads and invalidations under one feature-owned root. */
export const weeklyDayOffQueryKeys = {
  all: ['weekly-day-off'] as const,
  list: <T extends object>(filters: T) => ['weekly-day-off', 'list', filters] as const,
};

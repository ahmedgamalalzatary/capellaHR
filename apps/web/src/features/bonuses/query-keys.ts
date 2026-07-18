/** Keeps all bonus cache reads and invalidations under one feature-owned root. */
export const bonusQueryKeys = {
  all: ['bonuses'] as const,
  list: (filters: object) => ['bonuses', 'list', filters] as const,
};

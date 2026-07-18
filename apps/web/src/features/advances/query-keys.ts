/** Keeps all advance cache reads and invalidations under one feature-owned root. */
export const advanceQueryKeys = {
  all: ['advances'] as const,
  list: (filters: object) => ['advances', 'list', filters] as const,
};

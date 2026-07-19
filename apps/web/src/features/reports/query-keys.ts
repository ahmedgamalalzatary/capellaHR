/** Keeps all report cache reads and invalidations under one feature-owned root. */
export const reportQueryKeys = {
  all: ['reports'] as const,
  view: (reportType: string, filters: object) => ['reports', 'view', reportType, filters] as const,
  exports: () => ['reports', 'exports'] as const,
};

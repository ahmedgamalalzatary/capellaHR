export const dashboardQueryKeys = {
  all: ['dashboard'] as const,
  snapshot: () => [...dashboardQueryKeys.all, 'snapshot'] as const,
};

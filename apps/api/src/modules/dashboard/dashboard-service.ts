import type { DashboardSnapshotDto } from '@capella/contracts';

export interface DashboardRepository {
  getSnapshot(): Promise<DashboardSnapshotDto>;
}

export const createDashboardService = (repository: DashboardRepository) => ({
  getSnapshot: () => repository.getSnapshot(),
});

export type DashboardService = ReturnType<typeof createDashboardService>;

import type { DashboardSnapshotDto } from '@capella/contracts';

import { api } from '@/lib/api/client';

export const getDashboardSnapshot = () => api.get<DashboardSnapshotDto>('/dashboard');

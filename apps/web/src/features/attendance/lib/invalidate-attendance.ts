import type { QueryClient } from '@tanstack/react-query';

import { dashboardQueryKeys } from '../../dashboard/query-keys';
import { payrollQueryKeys } from '../../payroll/query-keys';
import { reportQueryKeys } from '../../reports/query-keys';
import { weeklyDayOffQueryKeys } from '../../weekly-day-off/query-keys';
import { attendanceQueryKeys } from '../query-keys';

/** Invalidates every cached projection whose facts can change with Attendance. */
export async function invalidateAttendanceDependents(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: attendanceQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: weeklyDayOffQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: payrollQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: reportQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['self-service'] }),
    queryClient.invalidateQueries({ queryKey: ['auth', 'session'] }),
  ]);
}

import type { Metadata } from 'next';

import { AdminAttendanceView } from '@/features/attendance';

export const metadata: Metadata = { title: 'الحضور والغياب' };

export default function AttendancePage() {
  return <AdminAttendanceView />;
}

import type { Metadata } from 'next';

import { WeeklyDayOffView } from '@/features/weekly-day-off';

export const metadata: Metadata = { title: 'الإجازة الأسبوعية' };

export default function WeeklyDayOffPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">الإجازة الأسبوعية</h2>
      <WeeklyDayOffView />
    </div>
  );
}

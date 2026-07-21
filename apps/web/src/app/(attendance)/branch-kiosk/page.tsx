import type { Metadata } from 'next';

import { DeviceAttendanceView } from '@/features/attendance';

export const metadata: Metadata = { title: 'هاتف الفرع' };

export default function BranchKioskPage() {
  return (
    <DeviceAttendanceView
      source="branch_device"
      eyebrow="محطة الحضور المشتركة"
      title="هاتف الفرع"
      description="أدخل كودك ورقمك السري، ثم أكمل تحقق هاتف الفرع وموقعه لتسجيل العملية."
    />
  );
}

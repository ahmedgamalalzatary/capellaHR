import type { Metadata } from 'next';

import { DeviceAttendanceView } from '@/features/attendance';

export const metadata: Metadata = { title: 'جهازي الشخصي' };

export default function PersonalDevicePage() {
  return (
    <DeviceAttendanceView
      source="personal_device"
      eyebrow="الجهاز الشخصي المسجل"
      title="الحضور من جهازي"
      description="سجّل حضورك أو انصرافك بعد التحقق من كود الموظف، موقع الفرع، وإثبات هذا الجهاز."
    />
  );
}

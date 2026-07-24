'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, LockKeyhole, MapPin, Repeat2, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { Button, Card, Field, Input } from '@capella/ui';

import { installationMarker } from '@/features/devices/lib/device-identity';
import { ApiError } from '@/lib/api/client';

import {
  recordEmployeeAttendance,
  type AttendanceDeviceSource,
  type AttendanceEventType,
  type AttendanceSession,
} from '../api/attendance-api';
import { AttendanceLocationError, currentAttendanceLocation } from '../lib/current-location';
import { invalidateAttendanceDependents } from '../lib/invalidate-attendance';
import { handleRtlTabKey } from '../lib/tab-keyboard';
import { AttendanceCameraCapture } from './attendance-camera-capture';

interface DeviceAttendanceViewProps {
  source: AttendanceDeviceSource;
  title: string;
  eyebrow: string;
  description: string;
}

const operationMessage = (eventType: AttendanceEventType) => (
  eventType === 'check_in' ? 'تم تسجيل الحضور' : 'تم تسجيل الانصراف'
);

const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof AttendanceLocationError) {
    if (error.reason === 'permission') return 'اسمح للموقع من إعدادات المتصفح، ثم أعد المحاولة.';
    if (error.reason === 'timeout') return 'استغرق تحديد الموقع وقتًا طويلًا. انتقل إلى مكان مفتوح وأعد المحاولة.';
    if (error.reason === 'unsupported') return 'هذا المتصفح لا يدعم تحديد الموقع المطلوب للحضور.';
    return 'تعذر تحديد موقعك بدقة. تأكد من تشغيل الموقع وأعد المحاولة.';
  }
  if (error instanceof Error && error.message === 'INVALID_EMPLOYEE_CODE') {
    return 'أدخل كود موظف صحيحًا بالأرقام الإنجليزية.';
  }
  if (error instanceof Error && error.message === 'INVALID_PIN') {
    return 'الرقم السري يجب أن يتكون من أربعة أرقام إنجليزية.';
  }
  if (error instanceof Error && error.message === 'FACE_REQUIRED') {
    return 'التقط صورة مباشرة قبل تسجيل الحضور.';
  }
  return 'تعذر إتمام العملية. تحقق من الاتصال وأعد المحاولة.';
};

function TrustStep({ icon, label }: { icon: ReactNode; label: string }) {
  return <li className="flex items-center gap-2 text-[12px] text-muted"><span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-paper text-muted">{icon}</span>{label}</li>;
}

export function DeviceAttendanceView({ source, title, eyebrow, description }: DeviceAttendanceViewProps) {
  const queryClient = useQueryClient();
  const [eventType, setEventType] = useState<AttendanceEventType>('check_in');
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [faceImage, setFaceImage] = useState<Blob | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [success, setSuccess] = useState<{
    session: AttendanceSession;
    eventType: AttendanceEventType;
  } | null>(null);
  const inputPrefix = useId();
  const isKiosk = source === 'branch_device';

  const attendance = useMutation({
    gcTime: 0,
    onMutate: () => setFailure(null),
    mutationFn: async (request: {
      eventType: AttendanceEventType;
      employeeCode: string;
      pin: string;
      faceImage: Blob | null;
    }) => {
      if (!/^\d+$/.test(request.employeeCode) || Number(request.employeeCode) <= 0) throw new Error('INVALID_EMPLOYEE_CODE');
      if (!/^\d{4}$/.test(request.pin)) throw new Error('INVALID_PIN');
      if (!request.faceImage) throw new Error('FACE_REQUIRED');
      const location = await currentAttendanceLocation();
      const marker = installationMarker();
      const session = await recordEmployeeAttendance(request.eventType, {
        employeeCode: Number(request.employeeCode),
        pin: request.pin,
        source,
        ...location,
        installationMarker: marker,
        faceImage: request.faceImage,
      });
      return { session, eventType: request.eventType };
    },
    onSuccess: (result) => {
      setSuccess(result);
      setEmployeeCode('');
      setPin('');
      setFaceImage(null);
      void invalidateAttendanceDependents(queryClient);
    },
    onError: () => {
      setPin('');
      setFaceImage(null);
      if (isKiosk) setEmployeeCode('');
    },
    onSettled: (_data, error) => {
      if (error) setFailure(error);
      queueMicrotask(() => attendance.reset());
    },
  });

  useEffect(() => {
    if (!success || !isKiosk) return;
    const timer = window.setTimeout(() => setSuccess(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [isKiosk, success]);

  const reset = () => {
    attendance.reset();
    setFailure(null);
    setSuccess(null);
    setEmployeeCode('');
    setPin('');
    setFaceImage(null);
  };
  const selectEvent = (next: AttendanceEventType) => {
    setEventType(next);
    attendance.reset();
    setFailure(null);
    if (isKiosk) {
      setEmployeeCode('');
      setPin('');
      setFaceImage(null);
    }
  };
  const eventTypes = ['check_in', 'check_out'] as const;

  if (success) {
    return (
      <main className="grid min-h-dvh place-items-center bg-surface p-4 sm:p-6">
        <Card className="w-full max-w-xl overflow-hidden text-center">
          <div role="status" aria-live="polite" className="px-6 py-10 sm:px-10">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-success-soft text-success"><Check className="size-8" aria-hidden /></span>
            <p className="mt-5 text-[12px] font-semibold tracking-[0.14em] text-success">{operationMessage(success.eventType)}</p>
            <h1 className="mt-2 text-3xl font-bold">{success.session.employeeName}</h1>
            <p className="mt-2 text-sm text-muted"><span className="tabular">{success.session.employeeCode}</span> · {success.session.branchName}</p>
            <p className="mt-5 text-sm text-muted">{success.eventType === 'check_in' ? 'نتمنى لك يوم عمل موفقًا.' : 'تم إغلاق جلسة العمل بنجاح.'}</p>
          </div>
          <div className="border-t border-line bg-surface px-6 py-4"><Button className="w-full" size="lg" onClick={reset}>{isKiosk ? 'تسجيل موظف آخر' : 'عملية حضور أخرى'}</Button>{isKiosk ? <p className="mt-2 text-[12px] text-muted">تعود الشاشة تلقائيًا بعد عشر ثوانٍ.</p> : null}</div>
        </Card>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4 py-8 sm:px-6">
      <Card className="w-full max-w-xl overflow-hidden">
        <header className="border-b border-line px-5 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] font-semibold tracking-[0.14em] text-muted">{eyebrow}</p>
            <Link href={isKiosk ? '/personal-device' : '/branch-kiosk'} className="inline-flex h-8 items-center justify-center gap-2 rounded-control border border-line bg-paper px-3 text-[12px] font-medium text-ink transition-colors hover:bg-surface">
              <Repeat2 className="size-4" aria-hidden />
              {isKiosk ? 'الانتقال إلى جهازي الشخصي' : 'الانتقال إلى هاتف الفرع'}
            </Link>
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 text-sm leading-7 text-muted">{description}</p>
        </header>

        <div className="px-5 py-6 sm:px-8">
          <div className="mb-6 grid grid-cols-2 gap-2" role="tablist" aria-label="نوع عملية الحضور">
            <Button id={`${inputPrefix}-check-in-tab`} role="tab" aria-selected={eventType === 'check_in'} aria-controls={`${inputPrefix}-attendance-form`} tabIndex={eventType === 'check_in' ? 0 : -1} size="lg" variant={eventType === 'check_in' ? 'primary' : 'secondary'} disabled={attendance.isPending} onKeyDown={(event) => handleRtlTabKey(event, 0, eventTypes, selectEvent)} onClick={() => selectEvent('check_in')}>تسجيل الحضور</Button>
            <Button id={`${inputPrefix}-check-out-tab`} role="tab" aria-selected={eventType === 'check_out'} aria-controls={`${inputPrefix}-attendance-form`} tabIndex={eventType === 'check_out' ? 0 : -1} size="lg" variant={eventType === 'check_out' ? 'primary' : 'secondary'} disabled={attendance.isPending} onKeyDown={(event) => handleRtlTabKey(event, 1, eventTypes, selectEvent)} onClick={() => selectEvent('check_out')}>تسجيل الانصراف</Button>
          </div>

          <form id={`${inputPrefix}-attendance-form`} role="tabpanel" aria-labelledby={`${inputPrefix}-${eventType === 'check_in' ? 'check-in' : 'check-out'}-tab`} autoComplete={isKiosk ? 'off' : 'on'} noValidate className="space-y-5" onSubmit={(event) => { event.preventDefault(); attendance.mutate({ eventType, employeeCode, pin, faceImage }); }}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="كود الموظف" htmlFor={`${inputPrefix}-employee-code`} required><Input id={`${inputPrefix}-employee-code`} aria-label="كود الموظف" inputMode="numeric" autoComplete={isKiosk ? 'off' : 'username'} className="tabular text-lg" disabled={attendance.isPending} value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} /></Field>
              <Field label="الرقم السري" htmlFor={`${inputPrefix}-pin`} required><Input id={`${inputPrefix}-pin`} aria-label="الرقم السري" type="password" inputMode="numeric" autoComplete={isKiosk ? 'off' : 'current-password'} maxLength={4} className="tabular text-lg tracking-[0.35em]" disabled={attendance.isPending} value={pin} onChange={(event) => setPin(event.target.value)} /></Field>
            </div>
            <AttendanceCameraCapture value={faceImage} onChange={setFaceImage} disabled={attendance.isPending} />
            {failure ? <div role="alert" className="rounded-control border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger"><p>{errorMessage(failure)}</p><Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setFailure(null)}>إعادة المحاولة</Button></div> : null}
            <Button type="submit" size="lg" className="w-full" disabled={attendance.isPending}>{attendance.isPending ? 'جارٍ التحقق…' : eventType === 'check_in' ? 'تسجيل الحضور' : 'تسجيل الانصراف'}</Button>
          </form>
        </div>

        <footer className="border-t border-line bg-surface px-5 py-4 sm:px-8">
          <ul className="grid gap-3 sm:grid-cols-3">
            <TrustStep icon={<LockKeyhole className="size-3.5" aria-hidden />} label="كود ورقم سري" />
            <TrustStep icon={<MapPin className="size-3.5" aria-hidden />} label="موقع الفرع" />
            <TrustStep icon={<Smartphone className="size-3.5" aria-hidden />} label={isKiosk ? 'هاتف الفرع المعتمد' : 'إثبات هذا الجهاز'} />
          </ul>
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-[12px] text-muted"><ShieldCheck className="size-4 shrink-0" aria-hidden />لا تُنشئ هذه العملية جلسة إدارية أو تكشف بيانات الموظف.</p>
        </footer>
      </Card>
    </main>
  );
}

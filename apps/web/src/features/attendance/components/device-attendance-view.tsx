'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Fingerprint, LocateFixed, LockKeyhole, MapPin, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Button, Card, Field, Input } from '@capella/ui';

import { installationMarker } from '@/features/devices/lib/device-identity';
import { ApiError } from '@/lib/api/client';

import {
  beginAttendanceDeviceAuthentication,
  recordEmployeeAttendance,
  type AttendanceDeviceSource,
  type AttendanceEventType,
  type AttendanceSession,
} from '../api/attendance-api';
import { AttendanceLocationError, currentAttendanceLocation } from '../lib/current-location';
import { invalidateAttendanceDependents } from '../lib/invalidate-attendance';
import { handleRtlTabKey } from '../lib/tab-keyboard';

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
  if (error instanceof Error && error.message === 'WEBAUTHN_UNSUPPORTED') {
    return 'هذا المتصفح لا يدعم إثبات الجهاز المسجل.';
  }
  if (error instanceof Error && error.message === 'INVALID_EMPLOYEE_CODE') {
    return 'أدخل كود موظف صحيحًا بالأرقام الإنجليزية.';
  }
  if (error instanceof Error && error.message === 'INVALID_PIN') {
    return 'الرقم السري يجب أن يتكون من أربعة أرقام إنجليزية.';
  }
  if (error instanceof Error && (error.name === 'NotAllowedError' || /NotAllowedError/i.test(error.message))) {
    return 'لم يكتمل تحقق الجهاز. وافق على طلب الجهاز ثم أعد المحاولة.';
  }
  return 'تعذر إتمام العملية. تحقق من الاتصال وأعد المحاولة.';
};

function TrustStep({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <li className="flex gap-3 border-b border-paper/10 py-3 last:border-0"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-paper/20 text-paper/75">{icon}</span><span><strong className="block text-sm font-medium text-paper">{title}</strong><span className="text-[12px] leading-5 text-paper/55">{detail}</span></span></li>;
}

export function DeviceAttendanceView({ source, title, eyebrow, description }: DeviceAttendanceViewProps) {
  const queryClient = useQueryClient();
  const [eventType, setEventType] = useState<AttendanceEventType>('check_in');
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [success, setSuccess] = useState<{
    session: AttendanceSession;
    eventType: AttendanceEventType;
  } | null>(null);
  const inputPrefix = useId();
  const isKiosk = source === 'branch_device';

  const attendance = useMutation({
    mutationFn: async (request: {
      eventType: AttendanceEventType;
      employeeCode: string;
      pin: string;
    }) => {
      if (!/^\d+$/.test(request.employeeCode) || Number(request.employeeCode) <= 0) throw new Error('INVALID_EMPLOYEE_CODE');
      if (!/^\d{4}$/.test(request.pin)) throw new Error('INVALID_PIN');
      if (typeof window.PublicKeyCredential === 'undefined') throw new Error('WEBAUTHN_UNSUPPORTED');

      // Location comes first so a denied permission never creates a one-time
      // WebAuthn challenge that cannot be reused.
      const location = await currentAttendanceLocation();
      const marker = installationMarker();
      const { challengeId, options } = await beginAttendanceDeviceAuthentication({
        employeeCode: Number(request.employeeCode),
        eventType: request.eventType,
        source,
        installationMarker: marker,
        ...location,
      });
      const response = await startAuthentication({ optionsJSON: options });
      const session = await recordEmployeeAttendance(request.eventType, {
        employeeCode: Number(request.employeeCode),
        pin: request.pin,
        source,
        ...location,
        deviceProof: {
          challengeId,
          installationMarker: marker,
          response: {
            ...response,
            clientExtensionResults: { ...response.clientExtensionResults },
          },
        },
      });
      return { session, eventType: request.eventType };
    },
    onSuccess: (result) => {
      setSuccess(result);
      setEmployeeCode('');
      setPin('');
      void invalidateAttendanceDependents(queryClient);
    },
    onError: () => {
      setPin('');
      if (isKiosk) setEmployeeCode('');
    },
  });

  useEffect(() => {
    if (!success || !isKiosk) return;
    const timer = window.setTimeout(() => setSuccess(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [isKiosk, success]);

  const reset = () => {
    attendance.reset();
    setSuccess(null);
    setEmployeeCode('');
    setPin('');
  };
  const selectEvent = (next: AttendanceEventType) => {
    setEventType(next);
    attendance.reset();
    if (isKiosk) {
      setEmployeeCode('');
      setPin('');
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
            <p className="mt-2 text-sm text-muted"><span className="tabular" dir="ltr">{success.session.employeeCode}</span> · {success.session.branchName}</p>
            <p className="mt-5 text-sm text-muted">{success.eventType === 'check_in' ? 'نتمنى لك يوم عمل موفقًا.' : 'تم إغلاق جلسة العمل بنجاح.'}</p>
          </div>
          <div className="border-t border-line bg-surface px-6 py-4"><Button className="w-full" size="lg" onClick={reset}>{isKiosk ? 'تسجيل موظف آخر' : 'عملية حضور أخرى'}</Button>{isKiosk ? <p className="mt-2 text-[12px] text-muted">تعود الشاشة تلقائيًا بعد عشر ثوانٍ.</p> : null}</div>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-surface px-4 py-6 sm:grid sm:place-items-center sm:px-6">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-card border border-line bg-paper shadow-sm lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="p-5 sm:p-8 lg:p-10">
          <header className="mb-7"><p className="text-[12px] font-semibold tracking-[0.14em] text-muted">{eyebrow}</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-xl text-sm leading-7 text-muted">{description}</p></header>

          <div className="mb-6 grid grid-cols-2 gap-2" role="tablist" aria-label="نوع عملية الحضور">
            <Button id={`${inputPrefix}-check-in-tab`} role="tab" aria-selected={eventType === 'check_in'} aria-controls={`${inputPrefix}-attendance-form`} tabIndex={eventType === 'check_in' ? 0 : -1} size="lg" variant={eventType === 'check_in' ? 'primary' : 'secondary'} disabled={attendance.isPending} onKeyDown={(event) => handleRtlTabKey(event, 0, eventTypes, selectEvent)} onClick={() => selectEvent('check_in')}>تسجيل الحضور</Button>
            <Button id={`${inputPrefix}-check-out-tab`} role="tab" aria-selected={eventType === 'check_out'} aria-controls={`${inputPrefix}-attendance-form`} tabIndex={eventType === 'check_out' ? 0 : -1} size="lg" variant={eventType === 'check_out' ? 'primary' : 'secondary'} disabled={attendance.isPending} onKeyDown={(event) => handleRtlTabKey(event, 1, eventTypes, selectEvent)} onClick={() => selectEvent('check_out')}>تسجيل الانصراف</Button>
          </div>

          <form id={`${inputPrefix}-attendance-form`} role="tabpanel" aria-labelledby={`${inputPrefix}-${eventType === 'check_in' ? 'check-in' : 'check-out'}-tab`} autoComplete={isKiosk ? 'off' : 'on'} noValidate className="space-y-5" onSubmit={(event) => { event.preventDefault(); attendance.mutate({ eventType, employeeCode, pin }); }}>
            <Field label="كود الموظف" htmlFor={`${inputPrefix}-employee-code`} required><Input id={`${inputPrefix}-employee-code`} aria-label="كود الموظف" inputMode="numeric" autoComplete={isKiosk ? 'off' : 'username'} dir="ltr" className="tabular text-lg" disabled={attendance.isPending} value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} /></Field>
            <Field label="الرقم السري" htmlFor={`${inputPrefix}-pin`} required><Input id={`${inputPrefix}-pin`} aria-label="الرقم السري" type="password" inputMode="numeric" autoComplete={isKiosk ? 'off' : 'current-password'} maxLength={4} dir="ltr" className="tabular text-lg tracking-[0.35em]" disabled={attendance.isPending} value={pin} onChange={(event) => setPin(event.target.value)} /></Field>
            {attendance.error ? <div role="alert" className="rounded-control border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger"><p>{errorMessage(attendance.error)}</p><Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => attendance.reset()}>إعادة المحاولة</Button></div> : null}
            <Button type="submit" size="lg" className="w-full" disabled={attendance.isPending}>{attendance.isPending ? 'جارٍ التحقق…' : eventType === 'check_in' ? 'تسجيل الحضور' : 'تسجيل الانصراف'}</Button>
            <p className="flex items-center justify-center gap-2 text-center text-[12px] text-muted"><ShieldCheck className="size-4" aria-hidden />لا تُنشئ هذه العملية جلسة إدارية أو تكشف بيانات الموظف.</p>
          </form>
        </section>

        <aside className="bg-ink p-6 text-paper sm:p-8 lg:flex lg:flex-col lg:justify-between">
          <div><Fingerprint className="size-8 text-paper/80" aria-hidden /><h2 className="mt-5 text-xl font-semibold">ثلاث خطوات للتحقق</h2><ul className="mt-4"><TrustStep icon={<LockKeyhole className="size-4" aria-hidden />} title="هوية الموظف" detail="الكود والرقم السري المكوّن من أربعة أرقام" /><TrustStep icon={<LocateFixed className="size-4" aria-hidden />} title="الموقع الحالي" detail="داخل نطاق الفرع المعيّن للموظف" /><TrustStep icon={<Fingerprint className="size-4" aria-hidden />} title="الجهاز المسجل" detail={isKiosk ? 'هاتف الفرع المرتبط مسبقًا' : 'هاتفك الشخصي المرتبط مسبقًا'} /></ul></div>
          <p className="mt-7 flex gap-2 border-t border-paper/10 pt-5 text-[12px] leading-6 text-paper/50"><MapPin className="mt-1 size-4 shrink-0" aria-hidden />يُستخدم موقعك فقط للتحقق من نطاق الحضور ويُحفظ مع محاولة الحضور وفق سياسة النظام.</p>
        </aside>
      </div>
    </main>
  );
}

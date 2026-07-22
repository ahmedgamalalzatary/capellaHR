'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  Clock3,
  FileWarning,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  UserCheck,
  UserRoundX,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type {
  DashboardAttendanceItem,
  DashboardEmployeeRef,
  DashboardSnapshotDto,
} from '@capella/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { getDashboardSnapshot } from '../api/dashboard-api';
import { dashboardQueryKeys } from '../query-keys';

const FAILURE_LABELS: Record<string, string> = {
  INVALID_CREDENTIALS: 'كود الموظف أو الرقم السري غير صحيح',
  DEVICE_INVALID: 'تعذر التحقق من الجهاز',
  DEVICE_REVOKED: 'الجهاز ملغى',
  OUT_OF_RANGE: 'خارج نطاق الفرع',
  WEEKLY_DAY_OFF: 'اليوم مسجل كراحة أسبوعية',
  SESSION_EXISTS: 'تم تسجيل الحضور لهذا اليوم',
  OPEN_SESSION_EXISTS: 'توجد جلسة حضور مفتوحة',
  NO_OPEN_SESSION: 'لا توجد جلسة حضور مفتوحة',
  INVALID_TIME: 'وقت الحضور غير صالح',
  TECHNICAL_FAILURE: 'عطل تقني',
};

const BLOCKER_LABELS: Record<string, string> = {
  ATTENDANCE_RECONCILIATION_PENDING: 'بيانات الحضور غير مكتملة',
  OPEN_SESSION: 'جلسة حضور ما زالت مفتوحة',
  DENIED_ATTEMPT: 'محاولة حضور لم تُراجع',
  PAYROLL_CHRONOLOGY_CONFLICT: 'يوجد شهر أقدم غير معتمد',
  PAYROLL_AMOUNT_OUT_OF_RANGE: 'قيمة الراتب خارج النطاق المسموح',
  ATTENDANCE_EMPLOYEE_NOT_FOUND: 'تعذر العثور على سجل الموظف',
};

const REPORT_LABELS: Record<string, string> = {
  branches: 'الفروع', employees: 'الموظفون', devices: 'الأجهزة', shifts: 'الورديات',
  'weekly-day-off': 'أيام الراحة', attendance: 'الحضور', payroll: 'الرواتب',
  bonuses: 'المكافآت', deductions: 'الخصومات', advances: 'السلف',
};

const PDF_STATUS: Record<DashboardSnapshotDto['pdfExports']['items'][number]['status'], {
  label: string;
  variant: 'neutral' | 'success' | 'warning' | 'danger';
}> = {
  queued: { label: 'في الانتظار', variant: 'neutral' },
  processing: { label: 'قيد التنفيذ', variant: 'warning' },
  completed: { label: 'مكتمل', variant: 'success' },
  failed: { label: 'فشل', variant: 'danger' },
};

const errorMessage = (error: unknown) => error instanceof ApiError
  ? error.message
  : 'تعذر تحميل لوحة العمليات. تحقق من الاتصال بالخادم ثم حاول مرة أخرى.';

function ModuleLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="inline-flex items-center gap-1 text-[12px] font-medium text-muted transition-colors hover:text-ink">
      {label}
      <ArrowLeft className="size-3.5" aria-hidden />
    </Link>
  );
}

function SummaryBlock({
  title,
  count,
  icon,
  link,
  children,
  tone = 'neutral',
}: {
  title: string;
  count?: number;
  icon: ReactNode;
  link: { href: string; label: string };
  children: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  const toneClass = tone === 'danger' ? 'border-s-danger'
    : tone === 'warning' ? 'border-s-warning' : 'border-s-line';
  return (
    <section className={`border-s-2 ${toneClass} ps-4`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted" aria-hidden>{icon}</span>
          <h3 className="text-sm font-semibold">{title}</h3>
          {count === undefined ? null : <span className="tabular text-[12px] text-muted">{count}</span>}
        </div>
        <ModuleLink {...link} />
      </div>
      {children}
    </section>
  );
}

const EmptyMini = ({ children }: { children: ReactNode }) => (
  <p className="rounded-control bg-surface px-3 py-3 text-[13px] text-muted">{children}</p>
);

function EmployeeLine({ employee, detail, danger = false }: {
  employee: DashboardEmployeeRef;
  detail?: ReactNode;
  danger?: boolean;
}) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {employee.employeeName}
          <span className="tabular ms-1.5 text-[12px] text-muted" dir="ltr">#{employee.employeeCode}</span>
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted">{employee.branchName}</p>
      </div>
      {detail ? <div className={danger ? 'max-w-[55%] text-end text-[12px] text-danger' : 'max-w-[55%] text-end text-[12px] text-muted'}>{detail}</div> : null}
    </li>
  );
}

function EmployeeList({
  items,
  detail,
  empty,
}: {
  items: DashboardEmployeeRef[];
  detail?: (item: DashboardEmployeeRef) => ReactNode;
  empty: string;
}) {
  return items.length ? (
    <ul className="divide-y divide-line/70">
      {items.map((item) => <EmployeeLine key={item.employeeId} employee={item} detail={detail?.(item)} />)}
    </ul>
  ) : <EmptyMini>{empty}</EmptyMini>;
}

function DashboardContent({ snapshot, refresh, refreshing }: {
  snapshot: DashboardSnapshotDto;
  refresh: () => void;
  refreshing: boolean;
}) {
  const formatters = useDisplayFormatters();
  const formatTime = (value: string) => formatters?.formatTime(value)
    ?? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const formatDateTime = (value: string) => formatters?.formatDateTime(value)
    ?? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const attendanceDetail = (item: DashboardEmployeeRef) => {
    const attendance = item as DashboardAttendanceItem;
    return <span className="tabular" dir="ltr">{formatTime(attendance.checkInAt)}</span>;
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-card bg-ink text-paper">
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1fr_auto] lg:items-end lg:px-7 lg:py-6">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-paper/55">تشغيل حي · بتوقيت القاهرة</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">لوحة عمليات اليوم</h1>
            <p className="tabular mt-2 text-sm text-paper/65" dir="ltr">{snapshot.cairoDate}</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-x-reverse divide-paper/15 rounded-control border border-paper/15">
            {[
              ['حاضرون الآن', snapshot.currentlyCheckedIn.total],
              ['جلسات سابقة', snapshot.previousDayOpen.total],
              ['لم يحضروا', snapshot.notCheckedIn.total],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 px-1.5 py-3 text-center sm:px-3">
                <p className="tabular text-2xl font-bold">{value}</p>
                <p className="mt-1 text-[11px] text-paper/60">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-paper/10 px-5 py-2.5 text-[11px] text-paper/55 lg:px-7">
          <span>آخر تحديث <span dir="ltr" className="tabular inline-block">{formatDateTime(snapshot.generatedAt)}</span></span>
          <Button variant="ghost" size="sm" className="text-paper hover:bg-paper/10 hover:text-paper" disabled={refreshing} onClick={refresh}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            تحديث الآن
          </Button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader><CardTitle>حركة اليوم</CardTitle></CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <SummaryBlock title="الحضور الآن" count={snapshot.currentlyCheckedIn.total} icon={<UserCheck className="size-4" />} link={{ href: '/attendance', label: 'فتح سجل الحضور' }}>
              <EmployeeList items={snapshot.currentlyCheckedIn.items} detail={attendanceDetail} empty="لا توجد جلسات حضور مفتوحة لليوم." />
            </SummaryBlock>
            <SummaryBlock title="لم يسجلوا الحضور" count={snapshot.notCheckedIn.total} icon={<UserRoundX className="size-4" />} link={{ href: '/attendance', label: 'مراجعة غير الحاضرين' }}>
              <EmployeeList items={snapshot.notCheckedIn.items} empty="سجل كل الموظفين المتوقعين حضورهم اليوم." />
            </SummaryBlock>
          </CardContent>
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader><CardTitle>يحتاج إلى تدخل</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <SummaryBlock title="جلسات من يوم سابق" count={snapshot.previousDayOpen.total} tone={snapshot.previousDayOpen.total ? 'danger' : 'neutral'} icon={<AlertTriangle className="size-4" />} link={{ href: '/attendance', label: 'مراجعة الجلسات السابقة' }}>
              <EmployeeList items={snapshot.previousDayOpen.items} detail={attendanceDetail} empty="لا توجد جلسات معلقة من يوم سابق." />
            </SummaryBlock>
            <SummaryBlock title="محاولات تحتاج مراجعة" count={snapshot.attendanceReview.unresolvedTotal} tone={snapshot.attendanceReview.flaggedTotal ? 'danger' : snapshot.attendanceReview.unresolvedTotal ? 'warning' : 'neutral'} icon={<ShieldAlert className="size-4" />} link={{ href: '/attendance', label: 'مراجعة محاولات الحضور' }}>
              {snapshot.attendanceReview.items.length ? <ul className="divide-y divide-line/70">{snapshot.attendanceReview.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.employeeName ?? `كود ${item.claimedEmployeeCode}`}</p>
                    <p className="mt-0.5 text-[12px] text-muted">{FAILURE_LABELS[item.failureReason] ?? item.failureReason}</p>
                    <p className="tabular mt-1 text-[11px] text-muted" dir="ltr">{formatDateTime(item.occurredAt)}</p>
                  </div>
                  {item.suspicious ? <Badge variant="danger">معلّمة</Badge> : <Badge variant="warning">مرفوضة</Badge>}
                </li>
              ))}</ul> : <EmptyMini>لا توجد محاولات معلقة للمراجعة.</EmptyMini>}
            </SummaryBlock>
            <SummaryBlock title="عوائق اعتماد الرواتب" count={snapshot.payrollBlockers.total} tone={snapshot.payrollBlockers.total ? 'warning' : 'neutral'} icon={<WalletCards className="size-4" />} link={{ href: '/payroll', label: 'فتح الرواتب' }}>
              {snapshot.payrollBlockers.items.length ? <ul className="divide-y divide-line/70">{snapshot.payrollBlockers.items.map((item) => (
                <EmployeeLine key={item.employeeId} employee={item} danger detail={(
                  <span>{item.reasons.map((reason) => BLOCKER_LABELS[reason] ?? reason).join('، ')}</span>
                )} />
              ))}</ul> : <EmptyMini>لا توجد عوائق في شهر الراتب <span className="tabular" dir="ltr">{snapshot.payrollMonth}</span>.</EmptyMini>}
            </SummaryBlock>
          </CardContent>
        </Card>

        <Card className="xl:col-span-7">
          <CardHeader><CardTitle>آخر حركة مسجلة</CardTitle></CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <SummaryBlock title="آخر الغياب وأيام الراحة" icon={<CalendarCheck className="size-4" />} link={{ href: '/weekly-day-off', label: 'فتح أيام الراحة' }}>
              {snapshot.latestDailyRecords.items.length ? <ul className="divide-y divide-line/70">{snapshot.latestDailyRecords.items.map((item) => (
                <EmployeeLine key={item.id} employee={item} detail={<span className="grid justify-items-end gap-1"><span className="tabular" dir="ltr">{item.attendanceDate}</span><Badge variant={item.status === 'absence' ? 'danger' : 'success'}>{item.status === 'absence' ? 'غياب' : 'يوم راحة'}</Badge></span>} />
              ))}</ul> : <EmptyMini>لا توجد سجلات غياب أو تحويلات حديثة.</EmptyMini>}
            </SummaryBlock>
            <SummaryBlock title="الخروج التلقائي" count={snapshot.automaticTimeouts.total} icon={<Clock3 className="size-4" />} link={{ href: '/attendance', label: 'مراجعة الخروج التلقائي' }}>
              {snapshot.automaticTimeouts.items.length ? <ul className="divide-y divide-line/70">{snapshot.automaticTimeouts.items.map((item) => (
                <EmployeeLine key={item.sessionId} employee={item} detail={<span className="grid justify-items-end gap-1"><span className="tabular" dir="ltr">{formatDateTime(item.automaticTimeoutAt)}</span><span>{item.correctedAt ? 'تم التصحيح' : 'بعد 16 ساعة'}</span></span>} />
              ))}</ul> : <EmptyMini>لا توجد حالات خروج تلقائي مسجلة.</EmptyMini>}
            </SummaryBlock>
          </CardContent>
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader><CardTitle>حالة الأنظمة</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <SummaryBlock title="ربط واستبدال الأجهزة" count={snapshot.devicePairings.pendingTotal} tone={snapshot.devicePairings.pendingTotal ? 'warning' : 'neutral'} icon={<Smartphone className="size-4" />} link={{ href: '/devices', label: 'فتح الأجهزة' }}>
              {snapshot.devicePairings.items.length ? <ul className="divide-y divide-line/70">{snapshot.devicePairings.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div><p className="text-sm font-medium">{item.assignmentName}</p><p className="mt-0.5 text-[12px] text-muted">{item.assignmentType === 'employee' ? 'هاتف موظف' : 'هاتف فرع'} · بانتظار فتح الرابط</p></div>
                  <Badge variant={item.kind === 'replacement' ? 'warning' : 'neutral'}>{item.kind === 'replacement' ? 'استبدال' : 'ربط جديد'}</Badge>
                </li>
              ))}</ul> : <EmptyMini>لا توجد طلبات ربط أو استبدال معلقة.</EmptyMini>}
            </SummaryBlock>
            <SummaryBlock title="حالة تصدير PDF" count={snapshot.pdfExports.failed} tone={snapshot.pdfExports.failed ? 'danger' : snapshot.pdfExports.processing ? 'warning' : 'neutral'} icon={<FileWarning className="size-4" />} link={{ href: '/reports', label: 'فتح التقارير' }}>
              <div className="mb-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                {[['انتظار', snapshot.pdfExports.queued], ['تنفيذ', snapshot.pdfExports.processing], ['مكتمل', snapshot.pdfExports.completed], ['فشل', snapshot.pdfExports.failed]].map(([label, value]) => (
                  <div key={label} className="rounded-control bg-surface px-1 py-2"><span className="tabular block text-sm font-semibold">{value}</span><span className="text-muted">{label}</span></div>
                ))}
              </div>
              {snapshot.pdfExports.items.length ? <ul className="divide-y divide-line/70">{snapshot.pdfExports.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div><p className="text-sm font-medium">{REPORT_LABELS[item.reportType] ?? item.reportType}</p><p className="tabular mt-0.5 text-[12px] text-muted" dir="ltr">#{item.id} · {formatDateTime(item.updatedAt)}</p></div>
                  <Badge variant={PDF_STATUS[item.status].variant}>{PDF_STATUS[item.status].label}</Badge>
                </li>
              ))}</ul> : <EmptyMini>لا توجد مهام تصدير مسجلة.</EmptyMini>}
            </SummaryBlock>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function DashboardView() {
  const snapshot = useQuery({
    queryKey: dashboardQueryKeys.snapshot(),
    queryFn: getDashboardSnapshot,
    retry: false,
    refetchInterval: 60_000,
  });

  if (snapshot.isPending) return (
    <Card><div className="px-6 py-20 text-center text-sm text-muted">جارٍ تجهيز لوحة العمليات…</div></Card>
  );
  if (snapshot.isError) return (
    <Card><EmptyState title="تعذر تحميل لوحة العمليات" description={errorMessage(snapshot.error)} action={(
      <Button variant="secondary" size="sm" onClick={() => void snapshot.refetch()}>إعادة المحاولة</Button>
    )} /></Card>
  );
  return <DashboardContent snapshot={snapshot.data} refresh={() => void snapshot.refetch()} refreshing={snapshot.isFetching} />;
}

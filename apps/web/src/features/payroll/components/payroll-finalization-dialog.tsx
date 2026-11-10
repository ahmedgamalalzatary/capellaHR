'use client';

import Link from 'next/link';
import { Button, Modal } from '@capella/ui';

import { ATTENDANCE_FAILURE_LABELS } from '../../attendance/lib/failure-labels';
import { describePayrollIssue, payrollAmountLabels, type PayrollFinalizationFailure } from './payroll-finalization-errors';

export type FinalizationFailureContext = PayrollFinalizationFailure & {
  title: string;
  subject: string;
  month: string;
};

const failureLabels = ATTENDANCE_FAILURE_LABELS;
const dailyLabels: Record<string, string> = {
  absence: 'غياب', weekly_day_off: 'إجازة أسبوعية', attendance_replaced: 'تم استبدال اليوم بحضور',
};
const cairoDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'وقت غير متاح' : new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn',
  }).format(date);
};

export function PayrollFinalizationDialog({ failure, onClose, onSelectMonth }: {
  failure: FinalizationFailureContext;
  onClose: () => void;
  onSelectMonth: (month: string, employeeCode?: number) => void;
}) {
  const hasAttendance = failure.issues.some(({ code }) => ['OPEN_SESSION', 'DENIED_ATTEMPT', 'ATTENDANCE_RECONCILIATION_PENDING'].includes(code));
  return (
    <Modal title={failure.title} onClose={onClose} className="max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted">{failure.subject} · شهر <bdi className="tabular">{failure.month}</bdi></p>
        <Button variant="secondary" className="min-h-11 shrink-0" onClick={onClose}>إغلاق</Button>
      </div>
      <p className="text-sm">راجع الأسباب التالية والخطوة المطلوبة لكل سبب قبل محاولة الاعتماد مجددًا.</p>
      <ul className="divide-y divide-line">
        {failure.issues.map((issue, index) => {
          const { title, action } = describePayrollIssue(issue);
          return (
            <li key={index} className="space-y-2 py-4 first:pt-0">
              <h3 className="text-sm font-semibold text-danger">{title}</h3>
              {issue.employeeName || issue.employeeCode !== undefined || issue.employeeId !== undefined ? (
                <p className="text-sm">{issue.employeeName ?? 'الموظف'} · {issue.employeeCode !== undefined ? 'كود' : 'رقم السجل'} <bdi className="tabular">{issue.employeeCode ?? issue.employeeId}</bdi></p>
              ) : null}
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {issue.attendanceDate ? <div><dt className="inline text-muted">اليوم: </dt><dd className="tabular inline"><bdi>{issue.attendanceDate}</bdi></dd></div> : null}
                {issue.sessionId ? <div><dt className="inline text-muted">رقم الجلسة: </dt><dd className="tabular inline">{issue.sessionId}</dd></div> : null}
                {issue.checkInAt ? <div className="sm:col-span-2"><dt className="inline text-muted">الحضور بتوقيت القاهرة: </dt><dd className="inline">{cairoDateTime(issue.checkInAt)}</dd></div> : null}
                {issue.attemptId ? <div><dt className="inline text-muted">رقم المحاولة: </dt><dd className="tabular inline">{issue.attemptId}</dd></div> : null}
                {issue.eventType ? <div><dt className="inline text-muted">نوع المحاولة: </dt><dd className="inline">{issue.eventType === 'check_in' ? 'حضور' : 'انصراف'}</dd></div> : null}
                {issue.occurredAt ? <div className="sm:col-span-2"><dt className="inline text-muted">وقت المحاولة بتوقيت القاهرة: </dt><dd className="inline">{cairoDateTime(issue.occurredAt)}</dd></div> : null}
                {issue.failureReason ? <div className="sm:col-span-2"><dt className="inline text-muted">سبب رفض المحاولة: </dt><dd className="inline">{failureLabels[issue.failureReason] ?? 'سبب غير معروف؛ راجع تفاصيل المحاولة في الحضور والغياب.'}</dd></div> : null}
                {issue.dailyStatus ? <div><dt className="inline text-muted">حالة اليوم: </dt><dd className="inline">{dailyLabels[issue.dailyStatus] ?? 'غير محددة'}</dd></div> : null}
                {issue.field ? <div><dt className="inline text-muted">البند: </dt><dd className="inline">{payrollAmountLabels[issue.field] ?? 'بند مالي'}</dd></div> : null}
                {issue.amount ? <div><dt className="inline text-muted">القيمة: </dt><dd className="tabular inline"><bdi>{issue.amount}</bdi> ج.م</dd></div> : null}
                {issue.limit ? <div className="sm:col-span-2"><dt className="inline text-muted">الحد للقيمة المطلقة: </dt><dd className="tabular inline"><bdi>{issue.limit}</bdi> ج.م</dd></div> : null}
                {issue.currentMonth ? <div><dt className="inline text-muted">الشهر الحالي: </dt><dd className="tabular inline"><bdi>{issue.currentMonth}</bdi></dd></div> : null}
                {issue.startMonth ? <div><dt className="inline text-muted">شهر بدء النظام: </dt><dd className="tabular inline"><bdi>{issue.startMonth}</bdi></dd></div> : null}
                {issue.finalizedAt ? <div className="sm:col-span-2"><dt className="inline text-muted">وقت الاعتماد: </dt><dd className="inline">{cairoDateTime(issue.finalizedAt)}</dd></div> : null}
              </dl>
              {issue.employmentPeriods?.length ? (
                <div className="space-y-1 text-sm">
                  <p className="text-muted">فترات العمل المسجلة بتوقيت القاهرة:</p>
                  <ul className="space-y-1">
                    {issue.employmentPeriods.map((period, periodIndex) => <li key={periodIndex}>من {cairoDateTime(period.activeFrom)} — {period.activeTo ? `حتى ${cairoDateTime(period.activeTo)}` : 'مستمرة'}</li>)}
                  </ul>
                </div>
              ) : null}
              <p className="text-sm leading-relaxed">{action}</p>
              {issue.months?.length ? (
                <div className="flex flex-wrap gap-2" aria-label="الشهور المطلوب اعتمادها">
                  {issue.months.map((month) => <Button key={month} variant="secondary" size="sm" className="min-h-11 tabular" onClick={() => onSelectMonth(month, issue.employeeCode)}>فتح شهر {month}</Button>)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {Object.values(failure.fieldErrors).flatMap((messages) => messages ?? []).map((message, index) => <p key={index} className="text-sm text-danger">{message}</p>)}
      {failure.requestId ? <p className="break-all text-xs text-muted">رقم الطلب للدعم: <bdi>{failure.requestId}</bdi></p> : null}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer py-2">معلومات المشكلة للدعم</summary>
        <ul className="space-y-1 break-all" dir="ltr">
          {[...new Set(failure.issues.map(({ code, failureReason }) => failureReason ? `${code}: ${failureReason}` : code))].map((code) => <li key={code}>{code}</li>)}
        </ul>
      </details>
      {hasAttendance ? <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Link href="/attendance" className="inline-flex min-h-11 items-center rounded-control border border-line px-4 text-sm font-medium hover:bg-surface">فتح الحضور والغياب</Link>
      </div> : null}
    </Modal>
  );
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarDays, Check, Clock3, RotateCcw, Search, ShieldAlert,
  UserCheck, UserRoundX, X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Badge, Button, Card, EmptyState, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { formatDuration } from '@/lib/utils/format';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listBranches } from '../../branches/api/branches-api';
import { listEmployees } from '../../employees/api/employees-api';
import {
  listWeeklyDayRecords,
  type ListWeeklyDayRecordsParams,
} from '../../weekly-day-off/api/weekly-day-off-api';
import {
  approveDeniedAttempt,
  correctAutomaticTimeout,
  dismissDeniedAttempt,
  listAttendanceDeniedAttempts,
  listAttendanceSessions,
  manualAttendance,
  type AttendanceDeniedAttempt,
  type AttendanceDeniedFilters,
  type AttendanceEventType,
  type AttendanceSession,
  type AttendanceSessionFilters,
} from '../api/attendance-api';
import { cairoLocalDateTimeToIso } from '../lib/cairo-time';
import { invalidateAttendanceDependents } from '../lib/invalidate-attendance';
import { handleRtlTabKey } from '../lib/tab-keyboard';
import { attendanceQueryKeys } from '../query-keys';

type Section = 'sessions' | 'denied' | 'manual' | 'absence';
const sections: Array<{ id: Section; label: string }> = [
  { id: 'sessions', label: 'سجل الحضور' },
  { id: 'denied', label: 'المحاولات المرفوضة' },
  { id: 'manual', label: 'تسجيل يدوي' },
  { id: 'absence', label: 'الغياب وأيام الراحة' },
];
const sectionIds = sections.map((section) => section.id);
const attendanceEventTypes = ['check_in', 'check_out'] as const;

const tabId = (section: Section) => `attendance-tab-${section}`;
const panelId = (section: Section) => `attendance-panel-${section}`;
const fallbackDateTime = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
});

const errorMessage = (error: unknown) => error instanceof ApiError
  ? error.message
  : 'حدث خطأ غير متوقع. حاول مرة أخرى.';

function QueryState({
  pending, error, empty, emptyTitle, onRetry, children,
}: {
  pending: boolean;
  error: unknown;
  empty: boolean;
  emptyTitle: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (pending) return <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل السجلات…</div>;
  if (error) return <div role="alert"><EmptyState title={errorMessage(error)} action={<Button variant="secondary" size="sm" onClick={onRetry}>إعادة المحاولة</Button>} /></div>;
  if (empty) return <EmptyState title={emptyTitle} />;
  return <>{children}</>;
}

function Pagination({ meta, onPage }: { meta: { page: number; total: number; totalPages: number } | undefined; onPage: (page: number) => void }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted">صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span> — <span className="tabular">{meta.total}</span> سجل</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>السابق</Button>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>التالي</Button>
      </div>
    </div>
  );
}

function Filters({
  searchLabel, searchInput, setSearchInput, onSearch, branchId, setBranchId,
  dateFrom, setDateFrom, dateTo, setDateTo, reset, children,
}: {
  searchLabel: string;
  searchInput: string;
  setSearchInput: (value: string) => void;
  onSearch: () => void;
  branchId: number | undefined;
  setBranchId: (value: number | undefined) => void;
  dateFrom: string;
  setDateFrom: (value: string) => void;
  dateTo: string;
  setDateTo: (value: string) => void;
  reset: () => void;
  children?: ReactNode;
}) {
  const branches = useQuery({
    queryKey: ['branches', 'attendance-options'],
    queryFn: () => fetchAllPages((page) => listBranches({ page })),
    retry: false,
  });
  return (
    <div className="rounded-card border border-line bg-paper p-3">
      <div className="flex flex-wrap items-end gap-2">
        <form role="search" className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <Field label={searchLabel} htmlFor={`${searchLabel}-input`}>
            <Input id={`${searchLabel}-input`} type="search" aria-label={searchLabel} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="w-56" />
          </Field>
          <Button type="submit" variant="secondary" size="sm"><Search className="size-4" aria-hidden />بحث</Button>
        </form>
        <Field label="الفرع" htmlFor={`${searchLabel}-branch`}>
          <select id={`${searchLabel}-branch`} aria-label="تصفية حسب الفرع" className="h-9 rounded-control border border-line bg-paper px-3 text-sm" value={branchId ?? ''} onChange={(event) => setBranchId(event.target.value ? Number(event.target.value) : undefined)} disabled={branches.isPending || branches.isError}>
            <option value="">كل الفروع</option>
            {(branches.data ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        <Field label="من تاريخ" htmlFor={`${searchLabel}-from`}><Input id={`${searchLabel}-from`} aria-label="من تاريخ" type="date" dir="ltr" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field>
        <Field label="إلى تاريخ" htmlFor={`${searchLabel}-to`}><Input id={`${searchLabel}-to`} aria-label="إلى تاريخ" type="date" dir="ltr" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field>
        {children}
        <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="size-4" aria-hidden />إعادة ضبط التصفية</Button>
      </div>
      {branches.isError ? <p role="alert" className="mt-2 text-[13px] text-danger">تعذر تحميل الفروع. <button className="underline" onClick={() => void branches.refetch()}>إعادة المحاولة</button></p> : null}
    </div>
  );
}

function SessionSection() {
  const queryClient = useQueryClient();
  const formatters = useDisplayFormatters();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<AttendanceSessionFilters>({ page: 1 });
  const [editing, setEditing] = useState<AttendanceSession | null>(null);
  const [correctedAt, setCorrectedAt] = useState('');
  const [correctionValidationError, setCorrectionValidationError] = useState<string | null>(null);
  const query = useQuery({ queryKey: attendanceQueryKeys.sessions(filters), queryFn: () => listAttendanceSessions(filters), retry: false });
  const correction = useMutation({
    mutationFn: ({ id, iso }: { id: number; iso: string }) => correctAutomaticTimeout(id, iso),
    onSuccess: async () => {
      setEditing(null);
      setCorrectedAt('');
      setCorrectionValidationError(null);
      await invalidateAttendanceDependents(queryClient);
    },
  });
  const dateTime = (value: string) => formatters?.formatDateTime(value) ?? fallbackDateTime.format(new Date(value));
  const update = (next: Partial<AttendanceSessionFilters>) => setFilters((current) => ({ ...current, ...next, page: 1 }));
  const reset = () => { setSearchInput(''); setFilters({ page: 1 }); };
  const items = query.data?.items ?? [];
  return (
    <div className="space-y-4">
      <Filters searchLabel="بحث في سجلات الحضور" searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => update({ search: searchInput.trim() || undefined })} branchId={filters.branchId} setBranchId={(branchId) => update({ branchId })} dateFrom={filters.dateFrom ?? ''} setDateFrom={(dateFrom) => update({ dateFrom: dateFrom || undefined })} dateTo={filters.dateTo ?? ''} setDateTo={(dateTo) => update({ dateTo: dateTo || undefined })} reset={reset}>
        <Field label="الحالة" htmlFor="attendance-session-state"><select id="attendance-session-state" aria-label="حالة الجلسة" className="h-9 rounded-control border border-line bg-paper px-3 text-sm" value={filters.state ?? ''} onChange={(event) => update({ state: event.target.value ? event.target.value as 'open' | 'closed' : undefined })}><option value="">كل الحالات</option><option value="open">مفتوحة</option><option value="closed">مغلقة</option></select></Field>
      </Filters>
      {correctionValidationError || correction.error ? <p role="alert" className="text-[13px] text-danger">{correctionValidationError ?? errorMessage(correction.error)}</p> : null}
      {editing ? (
        <Card className="border-warning/40 bg-warning-soft/40 p-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); const iso = cairoLocalDateTimeToIso(correctedAt); if (!iso) { setCorrectionValidationError('أدخل وقتًا صالحًا بتوقيت القاهرة.'); return; } setCorrectionValidationError(null); correction.mutate({ id: editing.id, iso }); }}>
            <Field label={`تصحيح خروج ${editing.employeeName}`} htmlFor="corrected-check-out" required><Input id="corrected-check-out" aria-label="وقت الانصراف المصحح" type="datetime-local" dir="ltr" required value={correctedAt} onChange={(event) => { setCorrectedAt(event.target.value); setCorrectionValidationError(null); }} /></Field>
            <Button type="submit" size="sm" disabled={!correctedAt || correction.isPending}>حفظ التصحيح</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(null); setCorrectionValidationError(null); }}>إلغاء</Button>
          </form>
        </Card>
      ) : null}
      <Card>
        <QueryState pending={query.isPending} error={query.error} empty={!items.length} emptyTitle="لا توجد سجلات حضور مطابقة" onRetry={() => void query.refetch()}>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-[12px] text-muted"><th className="px-4 py-2.5 text-start font-medium">الموظف</th><th className="px-4 py-2.5 text-start font-medium">الفرع</th><th className="px-4 py-2.5 text-start font-medium">تاريخ العمل</th><th className="px-4 py-2.5 text-start font-medium">الدخول / الخروج</th><th className="px-4 py-2.5 text-start font-medium">المدة</th><th className="px-4 py-2.5 text-start font-medium">الحالة</th><th className="px-4 py-2.5 text-start font-medium">إجراء</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-3"><span className="font-medium">{item.employeeName}</span><span className="ms-2 tabular text-muted" dir="ltr">{item.employeeCode}</span></td><td className="px-4 py-3 text-muted">{item.branchName}</td><td className="tabular px-4 py-3" dir="ltr">{item.attendanceDate}</td><td className="px-4 py-3"><div>{dateTime(item.checkInAt)}</div><div className="text-muted">{item.checkOutAt ? dateTime(item.checkOutAt) : 'لم يسجل الانصراف'}</div></td><td className="tabular px-4 py-3" dir="ltr">{item.workedMinutes === null ? '—' : formatDuration(item.workedMinutes)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{item.checkOutAt ? <Badge variant="neutral">مغلقة</Badge> : <Badge variant="success">مفتوحة</Badge>}{item.automaticTimeoutAt ? <Badge variant="warning">خروج تلقائي</Badge> : null}{item.flagged ? <Badge variant="danger">معلّمة</Badge> : null}</div></td><td className="px-4 py-3">{item.automaticTimeoutAt ? <Button variant="ghost" size="sm" onClick={() => { setEditing(item); setCorrectionValidationError(null); }}><Clock3 className="size-4" aria-hidden />تصحيح وقت الانصراف</Button> : <span className="text-muted">للقراءة فقط</span>}</td></tr>)}</tbody>
          </table></div>
        </QueryState>
      </Card>
      <Pagination meta={query.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
    </div>
  );
}

const failureLabels: Record<string, string> = {
  EMPLOYEE_NOT_FOUND: 'الموظف غير موجود',
  INVALID_CREDENTIALS: 'بيانات الموظف غير صحيحة', DEVICE_INVALID: 'الجهاز غير مسجل أو ملغى',
  OUT_OF_RANGE: 'خارج نطاق الفرع', WEEKLY_DAY_OFF: 'يوم راحة أسبوعي',
  SESSION_EXISTS: 'يوجد سجل لهذا اليوم', OPEN_SESSION_EXISTS: 'توجد جلسة مفتوحة',
  NO_OPEN_SESSION: 'لا توجد جلسة مفتوحة', INVALID_TIME: 'وقت غير صالح',
  FINANCIALLY_LOCKED: 'الفترة معتمدة ماليًا ولا يمكن تعديلها',
};

function DeniedSection() {
  const queryClient = useQueryClient();
  const formatters = useDisplayFormatters();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<AttendanceDeniedFilters>({ approvalState: 'pending', page: 1 });
  const query = useQuery({ queryKey: attendanceQueryKeys.denied(filters), queryFn: () => listAttendanceDeniedAttempts(filters), retry: false });
  const review = useMutation<AttendanceSession | AttendanceDeniedAttempt, Error, { id: number; action: 'approve' | 'dismiss' }>({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'dismiss' }) => action === 'approve' ? approveDeniedAttempt(id) : dismissDeniedAttempt(id),
    onSuccess: async () => {
      setFilters((current) => ({ ...current, page: 1 }));
      await invalidateAttendanceDependents(queryClient);
    },
  });
  const dateTime = (value: string) => formatters?.formatDateTime(value) ?? fallbackDateTime.format(new Date(value));
  const update = (next: Partial<AttendanceDeniedFilters>) => setFilters((current) => ({ ...current, ...next, page: 1 }));
  const reset = () => { setSearchInput(''); setFilters({ approvalState: 'pending', page: 1 }); };
  const items = query.data?.items ?? [];
  return <div className="space-y-4">
    <Filters searchLabel="بحث في المحاولات المرفوضة" searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => update({ search: searchInput.trim() || undefined })} branchId={filters.branchId} setBranchId={(branchId) => update({ branchId })} dateFrom={filters.dateFrom ?? ''} setDateFrom={(dateFrom) => update({ dateFrom: dateFrom || undefined })} dateTo={filters.dateTo ?? ''} setDateTo={(dateTo) => update({ dateTo: dateTo || undefined })} reset={reset}>
      <Field label="نوع الحدث" htmlFor="denied-event"><select id="denied-event" className="h-9 rounded-control border border-line bg-paper px-3 text-sm" value={filters.eventType ?? ''} onChange={(event) => update({ eventType: event.target.value ? event.target.value as AttendanceEventType : undefined })}><option value="">الكل</option><option value="check_in">حضور</option><option value="check_out">انصراف</option></select></Field>
      <Field label="المراجعة" htmlFor="denied-state"><select id="denied-state" className="h-9 rounded-control border border-line bg-paper px-3 text-sm" value={filters.approvalState ?? ''} onChange={(event) => update({ approvalState: event.target.value ? event.target.value as AttendanceDeniedFilters['approvalState'] : undefined })}><option value="">كل الحالات</option><option value="pending">تحتاج مراجعة</option><option value="approved">معتمدة</option><option value="dismissed">مرفوضة نهائيًا</option></select></Field>
      <Field label="نوع المحاولة" htmlFor="denied-suspicious"><select id="denied-suspicious" className="h-9 rounded-control border border-line bg-paper px-3 text-sm" value={filters.suspicious === undefined ? '' : String(filters.suspicious)} onChange={(event) => update({ suspicious: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">كل المحاولات</option><option value="true">مشتبه بها</option><option value="false">عادية</option></select></Field>
    </Filters>
    {review.error ? <p role="alert" className="text-[13px] text-danger">{errorMessage(review.error)}</p> : null}
    <Card><QueryState pending={query.isPending} error={query.error} empty={!items.length} emptyTitle="لا توجد محاولات مرفوضة مطابقة" onRetry={() => void query.refetch()}>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-[12px] text-muted"><th className="px-4 py-2.5 text-start font-medium">الموظف</th><th className="px-4 py-2.5 text-start font-medium">الحدث والمصدر</th><th className="px-4 py-2.5 text-start font-medium">الوقت</th><th className="px-4 py-2.5 text-start font-medium">سبب الرفض</th><th className="px-4 py-2.5 text-start font-medium">الموقع</th><th className="px-4 py-2.5 text-start font-medium">الحالة</th><th className="px-4 py-2.5 text-start font-medium">المراجعة</th></tr></thead><tbody>
        {items.map((item: AttendanceDeniedAttempt) => { const pending = !item.approvedAt && !item.dismissedAt; return <tr key={item.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-3"><span className="tabular" dir="ltr">{item.claimedEmployeeCode}</span></td><td className="px-4 py-3"><div>{item.eventType === 'check_in' ? 'حضور' : 'انصراف'}</div><div className="text-[12px] text-muted">{item.source === 'personal_device' ? 'هاتف شخصي' : 'هاتف الفرع'}</div></td><td className="px-4 py-3">{dateTime(item.occurredAt)}</td><td className="px-4 py-3">{failureLabels[item.failureReason] ?? 'سبب الرفض غير متاح'}</td><td className="px-4 py-3">{item.distanceMeters === null ? 'غير متاح' : <span className="tabular" dir="ltr">{Math.round(item.distanceMeters)} م / {item.branchRadiusMeters} م</span>}</td><td className="px-4 py-3">{item.suspicious ? <Badge variant="danger">مشتبه بها</Badge> : <Badge variant="warning">مرفوضة</Badge>}</td><td className="px-4 py-3">{pending ? <div className="flex flex-wrap gap-1">{item.employeeId !== null ? <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: item.id, action: 'approve' })}><Check className="size-4" aria-hidden />اعتماد المحاولة</Button> : <span className="basis-full text-[12px] text-muted">تعذر تحديد الموظف؛ يمكن الرفض النهائي فقط.</span>}<Button variant="ghost" size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: item.id, action: 'dismiss' })}><X className="size-4" aria-hidden />رفض نهائي</Button></div> : <Badge variant={item.approvedAt ? 'success' : 'neutral'}>{item.approvedAt ? 'معتمدة' : 'مرفوضة نهائيًا'}</Badge>}</td></tr>; })}
      </tbody></table></div>
    </QueryState></Card>
    <Pagination meta={query.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
  </div>;
}

function ManualSection() {
  const queryClient = useQueryClient();
  const [eventType, setEventType] = useState<AttendanceEventType>('check_in');
  const [employeeId, setEmployeeId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const employees = useQuery({ queryKey: ['employees', 'attendance-manual-options'], queryFn: () => fetchAllPages((page) => listEmployees({ page })), retry: false });
  const mutation = useMutation({
    mutationFn: () => { const iso = cairoLocalDateTimeToIso(occurredAt); if (!iso || !employeeId) throw new Error('FORM_INVALID'); return manualAttendance(eventType, { employeeId: Number(employeeId), occurredAt: iso }); },
    onSuccess: async (value) => {
      setSuccess(`${eventType === 'check_in' ? 'تم تسجيل الحضور' : 'تم تسجيل الانصراف'} للموظف ${value.employeeName}`);
      await invalidateAttendanceDependents(queryClient);
    },
  });
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
    <Card className="p-5"><div className="mb-5 flex gap-2" role="tablist" aria-label="نوع التسجيل اليدوي"><Button id="manual-tab-check-in" role="tab" aria-selected={eventType === 'check_in'} aria-controls="manual-event-form" tabIndex={eventType === 'check_in' ? 0 : -1} variant={eventType === 'check_in' ? 'primary' : 'secondary'} onKeyDown={(event) => handleRtlTabKey(event, 0, attendanceEventTypes, (next) => { setEventType(next); setSuccess(null); })} onClick={() => { setEventType('check_in'); setSuccess(null); }}><UserCheck className="size-4" aria-hidden />تسجيل حضور</Button><Button id="manual-tab-check-out" role="tab" aria-selected={eventType === 'check_out'} aria-controls="manual-event-form" tabIndex={eventType === 'check_out' ? 0 : -1} variant={eventType === 'check_out' ? 'primary' : 'secondary'} onKeyDown={(event) => handleRtlTabKey(event, 1, attendanceEventTypes, (next) => { setEventType(next); setSuccess(null); })} onClick={() => { setEventType('check_out'); setSuccess(null); }}><UserRoundX className="size-4" aria-hidden />تسجيل انصراف</Button></div>
      <form id="manual-event-form" role="tabpanel" aria-labelledby={eventType === 'check_in' ? 'manual-tab-check-in' : 'manual-tab-check-out'} className="space-y-4" onSubmit={(event) => { event.preventDefault(); setSuccess(null); mutation.mutate(); }}>
        <Field label="الموظف" htmlFor="manual-employee" required>{employees.isError ? <div role="alert" className="text-[13px] text-danger">تعذر تحميل الموظفين. <button type="button" className="underline" onClick={() => void employees.refetch()}>إعادة المحاولة</button></div> : <select id="manual-employee" aria-label="الموظف" required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="h-10 w-full rounded-control border border-line bg-paper px-3 text-sm"><option value="">اختر الموظف</option>{(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} — {employee.fullName}</option>)}</select>}</Field>
        <Field label="وقت الحدث بتوقيت القاهرة" htmlFor="manual-time" required><Input id="manual-time" aria-label="وقت الحدث بتوقيت القاهرة" type="datetime-local" dir="ltr" required value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></Field>
        {mutation.error ? <p role="alert" className="text-[13px] text-danger">{mutation.error instanceof ApiError ? mutation.error.message : 'اختر الموظف وأدخل وقتًا صالحًا بتوقيت القاهرة.'}</p> : null}
        {success ? <p role="status" className="rounded-control bg-success-soft px-3 py-2 text-sm text-success">{success}</p> : null}
        <Button type="submit" disabled={!employeeId || !occurredAt || mutation.isPending}>{eventType === 'check_in' ? 'تسجيل حضور يدوي' : 'تسجيل انصراف يدوي'}</Button>
      </form>
    </Card>
    <aside className="rounded-card border border-line bg-ink p-5 text-paper"><Clock3 className="mb-5 size-6" aria-hidden /><h2 className="text-lg font-semibold">استثناء إداري موثّق</h2><p className="mt-2 text-sm leading-7 text-paper/70">التسجيل اليدوي يتجاوز تحقق الموظف والجهاز والموقع، لكنه يخضع لكل قواعد الجلسات والتوقيت ويُحفظ في سجل التدقيق.</p></aside>
  </div>;
}

function AbsenceSection() {
  type AbsenceFilters = {
    search?: string | undefined;
    branchId?: number | undefined;
    status?: ListWeeklyDayRecordsParams['status'] | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    page?: number | undefined;
  };
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<AbsenceFilters>({ page: 1 });
  const query = useQuery({
    queryKey: ['weekly-day-off', 'attendance-page', filters],
    queryFn: () => listWeeklyDayRecords({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.branchId !== undefined ? { branchId: filters.branchId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
      page: filters.page ?? 1,
    }),
    retry: false,
  });
  const items = query.data?.items ?? [];
  const update = (next: Partial<AbsenceFilters>) => setFilters((current) => ({ ...current, ...next, page: 1 }));
  const reset = () => { setSearchInput(''); setFilters({ page: 1 }); };
  return <div className="space-y-4">
    <Filters searchLabel="بحث في سجل الغياب" searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => update({ search: searchInput.trim() || undefined })} branchId={filters.branchId} setBranchId={(branchId) => update({ branchId })} dateFrom={filters.dateFrom ?? ''} setDateFrom={(dateFrom) => update({ dateFrom: dateFrom || undefined })} dateTo={filters.dateTo ?? ''} setDateTo={(dateTo) => update({ dateTo: dateTo || undefined })} reset={reset}>
      <Field label="الحالة" htmlFor="absence-state"><select id="absence-state" aria-label="حالة الغياب" className="h-9 rounded-control border border-line bg-paper px-3 text-sm" value={filters.status ?? ''} onChange={(event) => update({ status: event.target.value ? event.target.value as ListWeeklyDayRecordsParams['status'] : undefined })}><option value="">كل الحالات</option><option value="absence">غياب</option><option value="weekly_day_off">يوم راحة</option></select></Field>
    </Filters>
    <Card><QueryState pending={query.isPending} error={query.error} empty={!items.length} emptyTitle="لا توجد سجلات غياب أو أيام راحة" onRetry={() => void query.refetch()}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-[12px] text-muted"><th className="px-4 py-2.5 text-start font-medium">الموظف</th><th className="px-4 py-2.5 text-start font-medium">الفرع</th><th className="px-4 py-2.5 text-start font-medium">التاريخ</th><th className="px-4 py-2.5 text-start font-medium">الحالة</th><th className="px-4 py-2.5 text-start font-medium">الدقائق المطلوبة</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-3"><span className="font-medium">{item.employeeName}</span><span className="ms-2 tabular text-muted" dir="ltr">{item.employeeCode}</span></td><td className="px-4 py-3 text-muted">{item.branchName}</td><td className="tabular px-4 py-3" dir="ltr">{item.attendanceDate}</td><td className="px-4 py-3"><Badge variant={item.status === 'absence' ? 'danger' : 'success'}>{item.status === 'absence' ? 'غياب' : 'يوم راحة'}</Badge></td><td className="tabular px-4 py-3" dir="ltr">{formatDuration(item.requiredMinutes)}</td></tr>)}</tbody></table></div></QueryState></Card>
    <Pagination meta={query.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
  </div>;
}

export function AdminAttendanceView() {
  const [section, setSection] = useState<Section>('sessions');
  return <div className="space-y-5">
    <header className="relative overflow-hidden rounded-card bg-ink px-5 py-6 text-paper sm:px-7"><div className="absolute inset-y-0 start-0 w-1 bg-success" aria-hidden /><p className="text-[12px] font-medium tracking-[0.18em] text-paper/55">سجل العمليات اليومية</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">الحضور والغياب</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-paper/70">راجع الجلسات والمحاولات المرفوضة، وسجّل الاستثناءات الإدارية وصحّح الخروج التلقائي من مكان واحد.</p></header>
    <nav className="overflow-x-auto" aria-label="أقسام الحضور"><div className="flex min-w-max gap-2" role="tablist">{sections.map((item, index) => <Button key={item.id} id={tabId(item.id)} role="tab" aria-selected={section === item.id} aria-controls={panelId(item.id)} tabIndex={section === item.id ? 0 : -1} variant={section === item.id ? 'primary' : 'secondary'} size="sm" onKeyDown={(event) => handleRtlTabKey(event, index, sectionIds, setSection)} onClick={() => setSection(item.id)}>{item.id === 'sessions' ? <CalendarDays className="size-4" aria-hidden /> : item.id === 'denied' ? <ShieldAlert className="size-4" aria-hidden /> : item.id === 'manual' ? <UserCheck className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}{item.label}</Button>)}</div></nav>
    <section id={panelId(section)} role="tabpanel" aria-labelledby={tabId(section)}>{section === 'sessions' ? <SessionSection /> : section === 'denied' ? <DeniedSection /> : section === 'manual' ? <ManualSection /> : <AbsenceSection />}</section>
  </div>;
}

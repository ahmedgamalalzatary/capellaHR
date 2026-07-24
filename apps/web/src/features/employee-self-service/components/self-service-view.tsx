'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, LogOut, MapPin, WalletCards } from 'lucide-react';
import { type KeyboardEvent, useEffect, useState } from 'react';

import { Badge, Button, Card, EmptyState, Input } from '@capella/ui';

import { SESSION_QUERY_KEY, useLogout } from '@/features/auth';
import { ApiError } from '@/lib/api/client';
import type { PageMeta } from '@/lib/api/client';

import {
  getSelfServiceOverview,
  getSelfServicePayrollMonth,
  listSelfServiceAdvances,
  listSelfServiceAttendance,
  listSelfServiceBonuses,
  listSelfServiceDeductions,
  listSelfServiceWeeklyDays,
} from '../api/self-service-api';

type Section = 'overview' | 'attendance' | 'weekly-days' | 'payroll' | 'bonuses' | 'deductions' | 'advances';

const sections: Array<{ id: Section; label: string }> = [
  { id: 'overview', label: 'بياناتي' },
  { id: 'attendance', label: 'الحضور' },
  { id: 'weekly-days', label: 'أيام الراحة والغياب' },
  { id: 'payroll', label: 'الراتب' },
  { id: 'bonuses', label: 'المكافآت' },
  { id: 'deductions', label: 'الخصومات' },
  { id: 'advances', label: 'السلف' },
];

const tabId = (section: Section) => `self-service-tab-${section}`;
const panelId = (section: Section) => `self-service-panel-${section}`;

const errorMessage = (error: unknown) => error instanceof ApiError
  ? error.message
  : 'تعذر تحميل البيانات. تحقق من اتصالك بالخادم ثم حاول مرة أخرى.';

const formatMoney = (amount: string) => `${amount} ج.م`;
const formatDuration = (minutes: number) => minutes % 60 === 0
  ? `${minutes / 60} ساعات`
  : `${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة`;
const formatAttendanceTime = (value: string | null) => value === null ? '—' : new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const currentCairoMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}`;
};

const Loading = () => <div className="px-5 py-12 text-center text-sm text-muted">جارٍ تحميل البيانات…</div>;

const QueryError = ({ error, retry }: { error: unknown; retry: () => void }) => (
  <EmptyState
    title="تعذر تحميل البيانات"
    description={errorMessage(error)}
    action={<Button variant="secondary" size="sm" onClick={retry}>إعادة المحاولة</Button>}
  />
);

const useExitOnUnauthorized = (error: unknown) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.removeQueries({ queryKey: ['self-service'] });
    }
  }, [error, queryClient]);
};

const Pagination = ({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) => meta.totalPages > 1 ? (
  <div className="flex items-center justify-between gap-3 text-sm">
    <p className="text-muted">صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span></p>
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>السابق</Button>
      <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>التالي</Button>
    </div>
  </div>
) : null;

function OverviewSection() {
  const query = useQuery({ queryKey: ['self-service', 'overview'], queryFn: getSelfServiceOverview, retry: false });
  useExitOnUnauthorized(query.error);
  if (query.isPending) return <Card><Loading /></Card>;
  if (query.isError) return <Card><QueryError error={query.error} retry={() => void query.refetch()} /></Card>;

  const { profile, branch, shift, baseSalary } = query.data;
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-ink px-5 py-5 text-paper">
          <p className="text-[11px] font-medium tracking-wide text-paper/65">سجل الموظف</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl font-bold">{profile.fullName}</h2>
            <span className="tabular text-sm">#{profile.employeeCode}</span>
          </div>
        </div>
        <dl className="grid gap-px bg-line sm:grid-cols-2">
          {[
            ['الهاتف الشخصي', profile.personalPhone],
            ['واتساب', profile.whatsappPhone],
            ['العمر', `${profile.age}`],
            ['العنوان', profile.address],
          ].map(([label, value]) => (
            <div key={label} className="bg-paper px-5 py-4">
              <dt className="text-[12px] text-muted">{label}</dt>
              <dd className="mt-1 text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <MapPin className="size-4 text-muted" aria-hidden />
          <p className="mt-3 text-[12px] text-muted">الفرع</p>
          <p className="mt-1 font-semibold">{branch.name}</p>
          <p className="mt-1 text-sm text-muted">{branch.location}</p>
        </Card>
        <Card className="p-4">
          <CalendarDays className="size-4 text-muted" aria-hidden />
          <p className="mt-3 text-[12px] text-muted">مدة الوردية الحالية</p>
          <p className="mt-1 font-semibold">{formatDuration(shift.durationMinutes)}</p>
        </Card>
        <Card className="p-4">
          <WalletCards className="size-4 text-muted" aria-hidden />
          <p className="mt-3 text-[12px] text-muted">الراتب الأساسي</p>
          <p className="tabular mt-1 font-semibold">{formatMoney(baseSalary.amount)}</p>
        </Card>
      </div>
    </div>
  );
}

function AttendanceSection() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['self-service', 'attendance', page],
    queryFn: () => listSelfServiceAttendance(page === 1 ? {} : { page }),
    retry: false,
  });
  useExitOnUnauthorized(query.error);
  if (query.isPending) return <Card><Loading /></Card>;
  if (query.isError) return <Card><QueryError error={query.error} retry={() => void query.refetch()} /></Card>;
  if (!query.data.items.length) return <Card><EmptyState title="لا توجد سجلات حضور حتى الآن" /></Card>;
  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-[12px] text-muted">
            <th className="px-4 py-3 text-start font-medium">التاريخ</th>
            <th className="px-4 py-3 text-start font-medium">الحالة</th>
            <th className="px-4 py-3 text-start font-medium">الحضور</th>
            <th className="px-4 py-3 text-start font-medium">الانصراف</th>
            <th className="px-4 py-3 text-start font-medium">المطلوب</th>
            <th className="px-4 py-3 text-start font-medium">دقائق العمل</th>
            <th className="px-4 py-3 text-start font-medium">إضافي</th>
            <th className="px-4 py-3 text-start font-medium">نقص</th>
          </tr></thead>
          <tbody>{query.data.items.map((record) => (
            <tr key={record.id} className="border-b border-line/60 last:border-0">
              <td className="tabular px-4 py-3">{record.attendanceDate}</td>
              <td className="px-4 py-3">
                <Badge variant={record.state === 'open' ? 'success' : 'neutral'}>
                  {record.state === 'open' ? 'مفتوح' : 'مغلق'}
                </Badge>
              </td>
              <td className="tabular px-4 py-3">{formatAttendanceTime(record.checkInAt)}</td>
              <td className="tabular px-4 py-3">{formatAttendanceTime(record.checkOutAt)}</td>
              <td className="tabular px-4 py-3">{record.requiredMinutes}</td>
              <td className="tabular px-4 py-3">{record.workedMinutes ?? '—'}</td>
              <td className="tabular px-4 py-3">{record.overtimeMinutes ?? '—'}</td>
              <td className="tabular px-4 py-3">{record.shortageMinutes ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Pagination meta={query.data.meta} onPage={setPage} />
    </div>
  );
}

function WeeklyDaysSection() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['self-service', 'weekly-days', page],
    queryFn: () => listSelfServiceWeeklyDays(page === 1 ? {} : { page }),
    retry: false,
  });
  useExitOnUnauthorized(query.error);
  if (query.isPending) return <Card><Loading /></Card>;
  if (query.isError) return <Card><QueryError error={query.error} retry={() => void query.refetch()} /></Card>;
  if (!query.data.items.length) return <Card><EmptyState title="لا توجد أيام غياب أو راحة مسجلة" /></Card>;
  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-[12px] text-muted">
          <th className="px-4 py-3 text-start font-medium">التاريخ</th>
          <th className="px-4 py-3 text-start font-medium">الحالة</th>
          <th className="px-4 py-3 text-start font-medium">الدقائق المطلوبة</th>
        </tr></thead>
        <tbody>{query.data.items.map((record) => (
          <tr key={record.id} className="border-b border-line/60 last:border-0">
            <td className="tabular px-4 py-3">{record.attendanceDate}</td>
            <td className="px-4 py-3"><Badge variant={record.status === 'weekly_day_off' ? 'success' : 'neutral'}>{record.status === 'weekly_day_off' ? 'يوم راحة' : 'غياب'}</Badge></td>
            <td className="tabular px-4 py-3">{record.requiredMinutes}</td>
          </tr>
        ))}</tbody>
      </table>
      </Card>
      <Pagination meta={query.data.meta} onPage={setPage} />
    </div>
  );
}

function AdjustmentSection({ kind }: { kind: 'bonuses' | 'deductions' }) {
  const [page, setPage] = useState(1);
  const read = kind === 'bonuses' ? listSelfServiceBonuses : listSelfServiceDeductions;
  const query = useQuery({
    queryKey: ['self-service', kind, page],
    queryFn: () => read(page === 1 ? {} : { page }),
    retry: false,
  });
  useExitOnUnauthorized(query.error);
  const noun = kind === 'bonuses' ? 'مكافآت' : 'خصومات';
  if (query.isPending) return <Card><Loading /></Card>;
  if (query.isError) return <Card><QueryError error={query.error} retry={() => void query.refetch()} /></Card>;
  if (!query.data.items.length) return <Card><EmptyState title={`لا توجد ${noun} مسجلة`} /></Card>;
  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-[12px] text-muted">
          <th className="px-4 py-3 text-start font-medium">شهر الراتب</th>
          <th className="px-4 py-3 text-start font-medium">المبلغ</th>
        </tr></thead>
        <tbody>{query.data.items.map((record) => (
          <tr key={record.id} className="border-b border-line/60 last:border-0">
            <td className="tabular px-4 py-3">{record.payrollMonth}</td>
            <td className="tabular px-4 py-3">{formatMoney(record.amount)}</td>
          </tr>
        ))}</tbody>
      </table>
      </Card>
      <Pagination meta={query.data.meta} onPage={setPage} />
    </div>
  );
}

function AdvancesSection() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['self-service', 'advances', page],
    queryFn: () => listSelfServiceAdvances(page === 1 ? {} : { page }),
    retry: false,
  });
  useExitOnUnauthorized(query.error);
  if (query.isPending) return <Card><Loading /></Card>;
  if (query.isError) return <Card><QueryError error={query.error} retry={() => void query.refetch()} /></Card>;
  if (!query.data.items.length) return <Card><EmptyState title="لا توجد سلف مسجلة" /></Card>;
  return <div className="space-y-3"><div className="space-y-3">{query.data.items.map((advance) => (
    <Card key={advance.id} className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div><p className="text-[12px] text-muted">إجمالي السلفة</p><p className="tabular mt-1 font-semibold">{formatMoney(advance.amount)}</p></div>
        <Badge variant="neutral">{advance.installmentCount} أقساط</Badge>
      </div>
      <ul className="divide-y divide-line/60">{advance.installments.map((installment) => (
        <li key={installment.ordinal} className="flex items-center justify-between gap-3 py-3 text-sm">
          <span>قسط {installment.ordinal}</span>
          <span className="tabular">{installment.payrollMonth}</span>
          <span className="tabular">{formatMoney(installment.amount)}</span>
        </li>
      ))}</ul>
    </Card>
  ))}</div><Pagination meta={query.data.meta} onPage={setPage} /></div>;
}

function PayrollSection() {
  const [monthInput, setMonthInput] = useState(currentCairoMonth);
  const [month, setMonth] = useState('');
  const query = useQuery({
    queryKey: ['self-service', 'payroll', month],
    queryFn: () => getSelfServicePayrollMonth(month),
    enabled: Boolean(month),
    retry: false,
  });
  useExitOnUnauthorized(query.error);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setMonth(monthInput); }}>
          <label className="space-y-1.5 text-sm" htmlFor="self-service-payroll-month">
            <span className="block font-medium">شهر الراتب</span>
            <Input id="self-service-payroll-month" type="month" value={monthInput} onChange={(event) => setMonthInput(event.target.value)} required />
          </label>
          <Button type="submit">عرض الراتب</Button>
        </form>
      </Card>
      {!month ? <Card><EmptyState title="اختر شهرًا لعرض تفاصيل الراتب" /></Card>
        : query.isPending ? <Card><Loading /></Card>
          : query.isError ? <p role="alert" className="rounded-card border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">{errorMessage(query.error)}</p>
            : query.data ? (
              <Card className="p-5">
                <div className="flex items-end justify-between gap-3 border-b border-line pb-4">
                  <div><p className="text-[12px] text-muted">صافي الراتب</p><p className="tabular mt-1 text-2xl font-bold">{formatMoney(query.data.netSalary)}</p></div>
                  <Badge variant={query.data.status === 'finalized' ? 'success' : 'neutral'}>{query.data.status === 'finalized' ? 'معتمد نهائيًا' : 'مفتوح'}</Badge>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  {([
                    ['الراتب الأساسي', query.data.baseSalary], ['بعد الاستحقاق', query.data.proratedBase],
                    ['الوقت الإضافي', query.data.overtimeAmount], ['المكافآت', query.data.bonusAmount],
                    ['خصم الحضور', query.data.attendanceDeductionAmount], ['الخصومات اليدوية', query.data.manualDeductionAmount],
                    ['السلف', query.data.advanceAmount], ['الترحيل السابق', query.data.priorNegativeCarry],
                  ] as Array<[string, string]>).map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="tabular">{formatMoney(amount)}</dd></div>)}
                </dl>
              </Card>
            ) : null}
    </div>
  );
}

export function SelfServiceView() {
  const [section, setSection] = useState<Section>('overview');
  const logout = useLogout();
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: Section) => {
    const currentIndex = sections.findIndex((item) => item.id === current);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft': nextIndex = (currentIndex + 1) % sections.length; break;
      case 'ArrowRight': nextIndex = (currentIndex - 1 + sections.length) % sections.length; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = sections.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const nextSection = sections[nextIndex]!.id;
    setSection(nextSection);
    document.getElementById(tabId(nextSection))?.focus();
  };
  return (
    <main className="min-h-dvh bg-surface">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-lg font-bold">الخدمة الذاتية</p>
            <p className="mt-0.5 text-[12px] text-muted">عرض فقط — تنتهي الجلسة عند تسجيل الخروج من الحضور</p>
          </div>
          <Button variant="secondary" size="sm" disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut className="size-4" aria-hidden />
            تسجيل الخروج
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <div role="tablist" aria-label="أقسام الخدمة الذاتية" className="mb-4 flex gap-1 overflow-x-auto border-b border-line pb-2">
          {sections.map((item) => (
            <Button key={item.id} id={tabId(item.id)} role="tab" aria-controls={panelId(item.id)} aria-selected={section === item.id} tabIndex={section === item.id ? 0 : -1} variant={section === item.id ? 'primary' : 'ghost'} size="sm" className="shrink-0" onClick={() => setSection(item.id)} onKeyDown={(event) => handleTabKeyDown(event, item.id)}>
              {item.label}
            </Button>
          ))}
        </div>
        <div id={panelId(section)} role="tabpanel" aria-labelledby={tabId(section)}>
          {section === 'overview' ? <OverviewSection /> : null}
          {section === 'attendance' ? <AttendanceSection /> : null}
          {section === 'weekly-days' ? <WeeklyDaysSection /> : null}
          {section === 'payroll' ? <PayrollSection /> : null}
          {section === 'bonuses' ? <AdjustmentSection kind="bonuses" /> : null}
          {section === 'deductions' ? <AdjustmentSection kind="deductions" /> : null}
          {section === 'advances' ? <AdvancesSection /> : null}
        </div>
      </div>
    </main>
  );
}

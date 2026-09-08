'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { PageHeader } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { listCashierSessionBranches } from '@/features/cashier-sessions';
import { Select } from '@/components/form/select';
import { ApiError } from '@/lib/api/client';
import { useTickingNow } from '@/lib/use-ticking-now';

import { listBookingEmployeeOptions, listBookings, updateBookingServicePreference, updateBookingStatus, type BookingDto } from '../api/bookings-api';
import { isOverdueBooked, orderBookingsForDiary } from '../order-bookings';
import { bookingQueryKeys } from '../query-keys';
import { BookingForm } from './booking-form';

const moveDate = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
};
const time = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));
const clientName = (booking: BookingDto) => (
  booking.client.fullName ?? booking.client.phone ?? 'عميل'
);
const statusLabel = {
  booked: 'محجوز', arrived: 'وصل', converted: 'تم البيع', cancelled: 'ملغي', no_show: 'لم يحضر',
} as const;
const statusTone = {
  booked: 'warning',
  arrived: 'success',
  converted: 'success',
  cancelled: 'danger',
  no_show: 'danger',
} as const;

const cairoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const dayHeading = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${value}T00:00:00Z`));

export function BookingsView({ initialDate }: { initialDate: string }) {
  const cache = useQueryClient();
  const session = useSession();
  const actor = session.data?.actor;
  const [date, setDate] = useState(initialDate);
  const [creating, setCreating] = useState(false);
  const [adminBranchId, setAdminBranchId] = useState<number>(() => {
    if (typeof sessionStorage === 'undefined') return undefined;
    const stored = sessionStorage.getItem('capella:pos-admin-branch');
    const parsed = stored ? Number(stored) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  });
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<{ id: number; next: 'cancelled' | 'no_show' } | null>(null);

  useEffect(() => {
    if (actor?.type !== 'admin') return;
    if (adminBranchId === undefined) {
      sessionStorage.removeItem('capella:pos-admin-branch');
      return;
    }
    sessionStorage.setItem('capella:pos-admin-branch', String(adminBranchId));
  }, [adminBranchId, actor?.type]);
  const branchId = actor?.type === 'admin' ? adminBranchId : undefined;
  const branches = useQuery({
    queryKey: ['booking-branches'],
    queryFn: () => listCashierSessionBranches(),
    enabled: actor?.type === 'admin',
  });
  const diary = useQuery({
    queryKey: bookingQueryKeys.day(date, branchId),
    queryFn: () => listBookings({ date, ...(branchId === undefined ? {} : { branchId }) }),
    enabled: actor?.type === 'cashier' || branchId !== undefined,
  });
  const employees = useQuery({
    queryKey: ['erp-bookings', 'employee-options', branchId ?? 'own'],
    queryFn: () => listBookingEmployeeOptions(branchId),
    enabled: actor?.type === 'cashier' || branchId !== undefined,
  });
  const status = useMutation({
    mutationFn: ({ id, next }: { id: number; next: 'arrived' | 'booked' | 'cancelled' | 'no_show' }) => (
      updateBookingStatus(id, { status: next, ...(branchId === undefined ? {} : { branchId }) })
    ),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'تعذر تحديث الحجز.'),
  });
  const preference = useMutation({
    mutationFn: ({ bookingId, serviceId, employeeId }: {
      bookingId: number; serviceId: number; employeeId: number | null;
    }) => updateBookingServicePreference(bookingId, serviceId, {
      preferredEmployeeId: employeeId,
      ...(branchId === undefined ? {} : { branchId }),
    }),
    onSuccess: async () => cache.invalidateQueries({ queryKey: bookingQueryKeys.all }),
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'تعذر تغيير الموظف المفضل.'),
  });
  const now = useTickingNow();
  const overdueCount = diary.data?.filter((booking) => isOverdueBooked(booking, now)).length ?? 0;
  const orderedBookings = diary.data ? orderBookingsForDiary(diary.data, now) : [];

  if (session.isPending) return <LoadingState label="جارٍ تحميل دفتر المواعيد…" />;
  if (session.isError) return <EmptyState title="تعذر التحقق من الجلسة" action={<Button onClick={() => void session.refetch()}>إعادة المحاولة</Button>} />;
  return <section className="space-y-5">
    <PageHeader
      title="دفتر المواعيد"
      description="مواعيد الفرع يومًا بيوم."
      actions={<Button disabled={actor?.type === 'admin' && branchId === undefined} onClick={() => setCreating(true)}><CalendarPlus className="size-4" />حجز جديد</Button>}
    />
    {actor?.type === 'admin' ? <Select aria-label="الفرع" value={branchId ?? ''} onChange={(event) => setAdminBranchId(event.target.value ? Number(event.target.value) : undefined)}>
      <option value="">اختر الفرع</option>
      {branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
    </Select> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <Card className="shadow-card"><CardContent className="flex items-center justify-between gap-3 p-4">
      <Button variant="secondary" aria-label="اليوم السابق" onClick={() => setDate(moveDate(date, -1))}>
        <ChevronRight className="size-4" />
      </Button>
      <div className="min-w-0 text-center">
        <h2 className="text-lg font-semibold">{dayHeading(date)}</h2>
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setDate(cairoToday())}>
          اليوم
        </Button>
      </div>
      <Button variant="secondary" aria-label="اليوم التالي" onClick={() => setDate(moveDate(date, 1))}>
        <ChevronLeft className="size-4" />
      </Button>
    </CardContent></Card>
    {actor?.type === 'admin' && branchId === undefined ? <EmptyState title="اختر فرعًا لعرض مواعيده" />
      : diary.isPending ? <LoadingState label="جارٍ تحميل المواعيد…" />
      : diary.isError ? <EmptyState title="تعذر تحميل المواعيد" action={<Button onClick={() => void diary.refetch()}>إعادة المحاولة</Button>} />
      : diary.data?.length === 0 ? <EmptyState title="لا توجد مواعيد في هذا اليوم" />
      : <div className="space-y-3">{orderedBookings.map((booking, index) => <div key={booking.id} className="space-y-3">
          {index === 0 && overdueCount > 0 ? <h2 className="font-semibold text-danger">لم يحضروا بعد</h2> : null}
          {index === overdueCount && overdueCount > 0 ? <h2 className="font-semibold">المواعيد الأخرى</h2> : null}
          <Card className="shadow-card">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <p className="tabular w-20 text-xl font-semibold">{time(booking.scheduledAt)}</p>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{clientName(booking)}</h3><Badge variant={statusTone[booking.status]}>{statusLabel[booking.status]}</Badge></div>
              <p className="text-sm text-muted">{booking.services.map(({ serviceName }) => serviceName).join('، ')}</p>
              {booking.services.some(({ preferredEmployee }) => preferredEmployee) ? <p className="text-sm text-muted">مع {booking.services.map(({ preferredEmployee }) => preferredEmployee?.name).filter(Boolean).join('، ')}</p> : null}
              {(booking.status === 'booked' || booking.status === 'arrived') ? booking.services.map((service) => <label key={service.serviceId} className="mt-2 flex items-center gap-2 text-sm">
                <span className="shrink-0">{service.serviceName}</span>
                <Select aria-label={`الموظف المفضل لخدمة ${service.serviceName}`} value={service.preferredEmployee?.id ?? ''} disabled={preference.isPending} onChange={(event) => preference.mutate({ bookingId: booking.id, serviceId: service.serviceId, employeeId: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">بدون موظف مفضل</option>
                  {employees.data?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                </Select>
              </label>) : null}
              {booking.note ? <p className="mt-1 text-sm">{booking.note}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {booking.status === 'booked' ? <>
                <Button disabled={status.isPending} onClick={() => status.mutate({ id: booking.id, next: 'arrived' })}>وصل العميل</Button>
                {new Date(booking.scheduledAt).getTime() < now ? <Button variant="secondary" disabled={status.isPending} onClick={() => setConfirming({ id: booking.id, next: 'no_show' })}>لم يحضر</Button> : null}
              </> : null}
              {booking.status === 'arrived' ? <>
                <Link
                  href={`/sales?bookingId=${booking.id}`}
                  className="inline-flex h-9 items-center justify-center rounded-control bg-ink px-4 text-sm font-medium text-paper"
                >
                  بدء البيع
                </Link>
                <Button variant="secondary" disabled={status.isPending} onClick={() => status.mutate({ id: booking.id, next: 'booked' })}>إرجاع إلى محجوز</Button>
              </> : null}
              {(booking.status === 'booked' || booking.status === 'arrived') ? <Button variant="ghost" disabled={status.isPending} onClick={() => setConfirming({ id: booking.id, next: 'cancelled' })}>إلغاء</Button> : null}
            </div>
          </CardContent>
        </Card></div>)}</div>}
    {creating ? <BookingForm {...(branchId === undefined ? {} : { branchId })} onClose={() => setCreating(false)} onSaved={async () => {
      await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
    }} /> : null}
    {confirming ? (
      <ConfirmDialog
        title={confirming.next === 'cancelled' ? 'إلغاء الموعد' : 'تسجيل عدم الحضور'}
        description={confirming.next === 'cancelled'
          ? 'سيُلغى هذا الموعد ولن يظهر كحجز قائم.'
          : 'سيُسجَّل أن العميل لم يحضر.'}
        confirmLabel={confirming.next === 'cancelled' ? 'تأكيد الإلغاء' : 'تأكيد عدم الحضور'}
        tone="danger"
        pending={status.isPending}
        onConfirm={() => {
          status.mutate(confirming, { onSettled: () => setConfirming(null) });
        }}
        onCancel={() => setConfirming(null)}
      />
    ) : null}
  </section>;
}

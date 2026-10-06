'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Trash2, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { PageHeader } from '@/components/layout/page-header';
import type { BookingRefundInput, PaymentMethod } from '@capella/contracts';

import { useSession } from '@/features/auth';
import {
  cashierSessionQueryKeys,
  getCurrentCashierSession,
  listCashierSessionBranches,
} from '@/features/cashier-sessions';
import { Select } from '@/components/form/select';
import { useAdminBranch } from '@/hooks/use-admin-branch';
import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { notifyError, notifySuccess } from '@/lib/notify';
import { useTickingNow } from '@/lib/use-ticking-now';

import {
  cancelBookingServices,
  deleteBooking,
  listBookingEmployeeOptions,
  listBookings,
  recordBookingPayment,
  rescheduleBooking,
  updateBookingServicePreference,
  updateBookingStatus,
  type BookingDto,
} from '../api/bookings-api';
import { excessAfterCancelling } from '../booking-money';
import { isOverdueBooked, orderBookingsForDiary } from '../order-bookings';
import { bookingQueryKeys } from '../query-keys';
import { BookingForm } from './booking-form';
import { BookingPaymentDialog, BookingRefundConfirm, RescheduleDialog } from './booking-money-dialogs';

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

type BookingService = BookingDto['services'][number];
const serviceStateLabel = (service: BookingService) => {
  if (service.status === 'cancelled') return 'ملغاة';
  if (service.status === 'pending') return 'لم تبدأ';
  return ({
    pending: 'لم تبدأ', in_progress: 'قيد التنفيذ', completed: 'تمت', overdue: 'متأخرة', canceled: 'ملغاة',
  } as const)[service.queueStatus ?? 'pending'];
};
const isOpenBooking = (booking: BookingDto) => booking.status === 'booked' || booking.status === 'arrived';

type Cancelling =
  | { bookingId: number; kind: 'cancelled' | 'no_show' }
  | { bookingId: number; kind: 'service'; serviceId: number };

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
  const { branchId: adminBranchId, setBranchId: setAdminBranchId } = useAdminBranch();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<Cancelling | null>(null);
  const [paying, setPaying] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<BookingDto | null>(null);

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
  // Money moves through the open shift's drawer; without one, paying and
  // refunding are unavailable.
  const shift = useQuery({
    queryKey: cashierSessionQueryKeys.current(branchId),
    queryFn: () => getCurrentCashierSession(branchId),
    enabled: actor?.type === 'cashier' || branchId !== undefined,
  });
  const cashierSessionId = shift.data?.id ?? null;
  const branchScope = branchId === undefined ? {} : { branchId };
  const failed = (fallback: string) => async (cause: unknown) => {
    const message = cause instanceof ApiError ? cause.message : fallback;
    setError(message);
    notifyError(cause, message);
    // The server answers from fresh money; reload so the next try shows it.
    await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
  };
  const status = useMutation({
    mutationFn: ({ id, next, refund }: {
      id: number;
      next: 'arrived' | 'booked' | 'cancelled' | 'no_show';
      refund?: BookingRefundInput | undefined;
    }) => (
      updateBookingStatus(id, { status: next, ...branchScope, ...(refund ? { refund } : {}) })
    ),
    onSuccess: async (_, { refund }) => {
      if (refund) await invalidateErpCaches(cache, 'booking-money');
      else await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
      notifySuccess('تم تحديث حالة الحجز.');
    },
    onError: failed('تعذر تحديث الحجز.'),
  });
  const cancelService = useMutation({
    mutationFn: ({ id, serviceId, refund }: {
      id: number; serviceId: number; refund?: BookingRefundInput | undefined;
    }) => cancelBookingServices(id, {
      ...branchScope, serviceIds: [serviceId], ...(refund ? { refund } : {}),
    }),
    onSuccess: async () => {
      await invalidateErpCaches(cache, 'booking-money');
      notifySuccess('تم إلغاء الخدمة.');
    },
    onError: failed('تعذر إلغاء الخدمة.'),
  });
  const payment = useMutation({
    mutationFn: ({ id, ...input }: {
      id: number; method: PaymentMethod; amount: string; operationReference: string;
    }) => recordBookingPayment(id, { ...branchScope, cashierSessionId: cashierSessionId!, ...input }),
    onSuccess: async () => {
      await invalidateErpCaches(cache, 'booking-money');
      notifySuccess('تم تسجيل الدفع المقدم.');
    },
    onError: failed('تعذر تسجيل الدفع المقدم.'),
  });
  const reschedule = useMutation({
    mutationFn: ({ id, scheduledAt }: { id: number; scheduledAt: string }) => (
      rescheduleBooking(id, { ...branchScope, scheduledAt })
    ),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
      notifySuccess('تم تغيير الموعد.');
    },
    onError: failed('تعذر تغيير الموعد.'),
  });
  const preference = useMutation({
    mutationFn: ({ bookingId, serviceId, employeeId }: {
      bookingId: number; serviceId: number; employeeId: number | null;
    }) => updateBookingServicePreference(bookingId, serviceId, {
      preferredEmployeeId: employeeId,
      ...(branchId === undefined ? {} : { branchId }),
    }),
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: bookingQueryKeys.all }); notifySuccess('تم حفظ الموظف المفضل.'); },
    onError: (cause: unknown) => {
      const message = cause instanceof ApiError ? cause.message : 'تعذر تغيير الموظف المفضل.';
      setError(message);
      notifyError(cause, message);
    },
  });
  const removal = useMutation({
    mutationFn: (id: number) => deleteBooking(id, branchId),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
      notifySuccess('تم حذف الموعد.');
    },
    onError: (cause: unknown) => {
      const message = cause instanceof ApiError ? cause.message : 'تعذر حذف الموعد.';
      setError(message);
      notifyError(cause, message);
    },
  });
  const now = useTickingNow();
  const overdueCount = diary.data?.filter((booking) => isOverdueBooked(booking, now)).length ?? 0;
  const orderedBookings = diary.data ? orderBookingsForDiary(diary.data, now) : [];
  // Dialogs read the booking from the latest diary data, so a refetch after a
  // refused refund shows the server's current amount.
  const confirmingBooking = confirming ? diary.data?.find(({ id }) => id === confirming.bookingId) : undefined;
  const payingBooking = paying === null ? undefined : diary.data?.find(({ id }) => id === paying);

  if (session.isPending) return <LoadingState label="جارٍ تحميل دفتر المواعيد…" />;
  if (session.isError) return <EmptyState title="تعذر التحقق من الجلسة" action={<Button onClick={() => void session.refetch()}>إعادة المحاولة</Button>} />;
  return <section className="space-y-5">
    <PageHeader
      title="دفتر المواعيد"
      description="مواعيد الفرع يومًا بيوم."
      actions={<Button disabled={actor?.type === 'admin' && branchId === undefined} onClick={() => setCreating(true)}><CalendarPlus className="size-4" />حجز جديد</Button>}
    />
    {actor?.type === 'admin' ? <Select
      aria-label="الفرع"
      className="max-w-sm"
      disabled={branches.isPending || branches.isError}
      value={branchId ?? ''}
      onChange={(event) => setAdminBranchId(event.target.value ? Number(event.target.value) : undefined)}
    >
      <option value="">اختر الفرع</option>
      {branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
    </Select> : null}
    {actor?.type === 'admin' && branches.isError ? (
      <Notice tone="danger" role="alert">
        <p>تعذر تحميل الفروع.</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void branches.refetch()}>
          إعادة المحاولة
        </Button>
      </Notice>
    ) : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <Card className="shadow-card"><CardContent className="flex items-center justify-between gap-3 p-4">
      <Button variant="secondary" aria-label="اليوم السابق" onClick={() => setDate(moveDate(date, -1))}>
        <ChevronRight className="size-4" />
      </Button>
      <div className="min-w-0 text-center">
        <h2 className="text-lg font-semibold">{dayHeading(date)}</h2>
        <div className="mt-1 flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDate(cairoToday())}>
            اليوم
          </Button>
          <Input
            id="booking-day"
            aria-label="اختر اليوم"
            type="date"
            value={date}
            onChange={(event) => { if (event.target.value) setDate(event.target.value); }}
            className="w-40"
          />
        </div>
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
          <Card className="overflow-hidden shadow-card">
          <CardContent className="p-0">
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold">{clientName(booking)}</h3>
                    <Badge variant={statusTone[booking.status]}>{statusLabel[booking.status]}</Badge>
                  </div>
                  {booking.client.phone ? <p dir="ltr" className="tabular mt-0.5 text-right text-[13px] text-muted">{booking.client.phone}</p> : null}
                </div>
                <div className="flex h-16 w-[76px] shrink-0 flex-col items-center justify-center rounded-control bg-ink text-paper">
                  <span className="tabular text-lg font-bold leading-none">{time(booking.scheduledAt)}</span>
                  <span className="tabular mt-1.5 text-[11px] opacity-70">#{booking.id}</span>
                </div>
              </div>
              <ul className="divide-y divide-line rounded-control border border-line bg-surface/50">
                {booking.services.map((service) => {
                  const options = employees.data ?? [];
                  const preferredMissing = service.preferredEmployee
                    && !options.some((employee) => employee.id === service.preferredEmployee?.id);
                  return (
                  <li key={service.serviceId} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-40" />
                      <span className="truncate text-sm font-medium">{service.serviceName}</span>
                      {service.servicePrice !== null ? <span className="tabular shrink-0 text-[13px] text-muted">{service.servicePrice} ج</span> : null}
                      <Badge variant={service.status === 'cancelled' ? 'danger' : service.status === 'sold' ? 'success' : 'warning'}>
                        {serviceStateLabel(service)}
                      </Badge>
                      {service.invoiceNumber ? <span className="font-mono text-[12px] text-muted">{service.invoiceNumber}</span> : null}
                    </div>
                    {isOpenBooking(booking) && service.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <Select className="sm:w-48" aria-label={`الموظف المفضل لخدمة ${service.serviceName}`} value={service.preferredEmployee?.id ?? ''} disabled={preference.isPending} onChange={(event) => preference.mutate({ bookingId: booking.id, serviceId: service.serviceId, employeeId: event.target.value ? Number(event.target.value) : null })}>
                          <option value="">بدون موظف مفضل</option>
                          {preferredMissing ? <option value={service.preferredEmployee?.id}>{service.preferredEmployee?.name}</option> : null}
                          {options.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                        </Select>
                        <Button variant="ghost" size="sm" aria-label={`إلغاء خدمة ${service.serviceName}`} disabled={cancelService.isPending} onClick={() => setConfirming({ bookingId: booking.id, kind: 'service', serviceId: service.serviceId })}>
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : service.preferredEmployee ? (
                      <span className="text-[13px] text-muted">مع {service.preferredEmployee.name}</span>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
              <p className="text-[13px] text-muted">
                {booking.services.length === 1 ? 'خدمة واحدة' : `${booking.services.length} خدمات`}
                {booking.services.some(({ servicePrice }) => servicePrice !== null)
                  ? ` • الإجمالي ${booking.services.reduce((sum, { servicePrice }) => sum + Number(servicePrice ?? 0), 0).toFixed(2)} ج`
                  : null}
              </p>
              {booking.note ? <p className="rounded-control bg-surface px-3 py-2 text-sm">{booking.note}</p> : null}
              <ul aria-label="أموال الحجز" className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
                {([
                  ['مدفوع مقدم', booking.money.paid],
                  ['مستخدم', booking.money.applied],
                  ['مسترد', booking.money.refunded],
                  ['المتبقي لدينا', booking.money.held],
                ] as const).map(([label, value]) => (
                  <li key={label} className="rounded-control border border-line px-3 py-2">
                    <span className="block text-muted">{label}</span>
                    <span className="tabular font-semibold">{value} ج</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {booking.status === 'booked' ? <>
                  <Button disabled={status.isPending} onClick={() => status.mutate({ id: booking.id, next: 'arrived' })}>وصل العميل</Button>
                  {new Date(booking.scheduledAt).getTime() < now ? <Button variant="secondary" disabled={status.isPending} onClick={() => setConfirming({ bookingId: booking.id, kind: 'no_show' })}>لم يحضر</Button> : null}
                </> : null}
                {booking.status === 'arrived' && booking.services.some((service) => service.status === 'pending') ? <>
                  <Link
                    href={`/sales?bookingId=${booking.id}`}
                    className="inline-flex h-9 items-center justify-center rounded-control bg-ink px-4 text-sm font-medium text-paper"
                  >
                    بدء البيع
                  </Link>
                  <Button variant="secondary" disabled={status.isPending} onClick={() => status.mutate({ id: booking.id, next: 'booked' })}>إرجاع إلى محجوز</Button>
                </> : null}
                {isOpenBooking(booking) ? <>
                  <Button
                    variant="secondary"
                    disabled={payment.isPending || cashierSessionId === null || booking.money.maxPayable === '0.00'}
                    title={cashierSessionId === null ? 'افتح وردية أولًا' : undefined}
                    onClick={() => setPaying(booking.id)}
                  >
                    <Wallet className="size-4" />دفع مقدم
                  </Button>
                  <Button variant="ghost" disabled={reschedule.isPending} onClick={() => setMoving(booking.id)}>
                    <CalendarClock className="size-4" />تغيير الموعد
                  </Button>
                  <Button variant="ghost" disabled={status.isPending} onClick={() => setConfirming({ bookingId: booking.id, kind: 'cancelled' })}>إلغاء</Button>
                </> : null}
                {(booking.status === 'booked' || booking.status === 'cancelled' || booking.status === 'no_show')
                  && booking.money.paid === '0.00' && booking.services.every((service) => service.status !== 'sold') ? (
                  <Button variant="ghost" className="ms-auto text-danger hover:bg-danger/10 hover:text-danger" disabled={removal.isPending} onClick={() => setDeleting(booking)}>
                    <Trash2 className="size-4" />حذف
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card></div>)}</div>}
    {creating ? <BookingForm {...(branchId === undefined ? {} : { branchId })} onClose={() => setCreating(false)} onSaved={async () => {
      await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
    }} /> : null}
    {confirmingBooking && confirming ? (() => {
      const pendingIds = confirmingBooking.services
        .filter((service) => service.status === 'pending').map((service) => service.serviceId);
      const serviceName = confirming.kind === 'service'
        ? confirmingBooking.services.find((service) => service.serviceId === confirming.serviceId)?.serviceName
        : undefined;
      const amount = excessAfterCancelling(
        confirmingBooking,
        confirming.kind === 'service' ? [confirming.serviceId] : pendingIds,
      );
      const close = () => setConfirming(null);
      return (
        <BookingRefundConfirm
          key={`${confirming.kind}-${amount}`}
          title={confirming.kind === 'service' ? `إلغاء خدمة ${serviceName ?? ''}`
            : confirming.kind === 'cancelled' ? 'إلغاء الموعد' : 'تسجيل عدم الحضور'}
          description={confirming.kind === 'service'
            ? 'ستُلغى هذه الخدمة من الحجز وتبقى بقية الخدمات.'
            : confirming.kind === 'cancelled'
              ? 'سيُلغى هذا الموعد ولن يظهر كحجز قائم.'
              : 'سيُسجَّل أن العميل لم يحضر.'}
          confirmLabel={confirming.kind === 'service' ? 'تأكيد إلغاء الخدمة'
            : confirming.kind === 'cancelled' ? 'تأكيد الإلغاء' : 'تأكيد عدم الحضور'}
          amount={amount}
          cashierSessionId={cashierSessionId}
          pending={status.isPending || cancelService.isPending}
          onConfirm={(refund) => {
            if (confirming.kind === 'service') {
              cancelService.mutate(
                { id: confirming.bookingId, serviceId: confirming.serviceId, refund },
                { onSuccess: close },
              );
            } else {
              status.mutate(
                { id: confirming.bookingId, next: confirming.kind, refund },
                { onSuccess: close },
              );
            }
          }}
          onCancel={close}
        />
      );
    })() : null}
    {payingBooking ? (
      <BookingPaymentDialog
        maxPayable={payingBooking.money.maxPayable}
        pending={payment.isPending}
        onSubmit={(input) => payment.mutate({ id: payingBooking.id, ...input }, { onSuccess: () => setPaying(null) })}
        onClose={() => setPaying(null)}
      />
    ) : null}
    {moving !== null ? (
      <RescheduleDialog
        pending={reschedule.isPending}
        onSubmit={(scheduledAt) => reschedule.mutate({ id: moving, scheduledAt }, { onSuccess: () => setMoving(null) })}
        onClose={() => setMoving(null)}
      />
    ) : null}
    {deleting ? (
      <ConfirmDialog
        title="حذف الموعد"
        description="سيُحذف هذا الموعد نهائيًا ولا يمكن التراجع. لا يمكن الحذف إذا دُفع مقدم أو بِيعت إحدى خدماته."
        confirmLabel="تأكيد الحذف"
        tone="danger"
        pending={removal.isPending}
        onConfirm={() => {
          removal.mutate(deleting.id, { onSettled: () => setDeleting(null) });
        }}
        onCancel={() => setDeleting(null)}
      />
    ) : null}
  </section>;
}

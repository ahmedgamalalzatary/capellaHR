'use client';

import type { BookingRefundInput } from '@capella/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Modal } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { notifyError, notifySuccess } from '@/lib/notify';

import {
  cancelBookingServices,
  getBooking,
  rescheduleBooking,
  updateBookingStatus,
} from '../api/bookings-api';
import { excessAfterCancelling } from '../booking-money';
import { bookingQueryKeys } from '../query-keys';
import { BookingRefundConfirm, RescheduleDialog } from './booking-money-dialogs';

/**
 * After a booking sale that left services waiting, the cashier must say what
 * happens to them: keep the original appointment, move it, or cancel them. The
 * dialog cannot be dismissed; it closes once the booking is no longer waiting
 * at the till.
 */
export function BookingLeftoverDialog({ bookingId, branchId, cashierSessionId }: {
  bookingId: number;
  branchId?: number;
  cashierSessionId: number;
}) {
  const cache = useQueryClient();
  const [step, setStep] = useState<'choose' | 'move' | 'cancel'>('choose');
  const [error, setError] = useState<string>();
  const booking = useQuery({
    queryKey: bookingQueryKeys.detail(bookingId, branchId),
    queryFn: () => getBooking(bookingId, branchId),
  });
  const branchScope = branchId === undefined ? {} : { branchId };
  const done = (message: string) => async () => {
    setError(undefined);
    setStep('choose');
    await invalidateErpCaches(cache, 'booking-money');
    notifySuccess(message);
  };
  const failed = async (cause: unknown) => {
    const message = cause instanceof ApiError ? cause.message : 'تعذر تحديث الحجز.';
    setError(message);
    notifyError(cause, message);
    await cache.invalidateQueries({ queryKey: bookingQueryKeys.all });
  };
  const keep = useMutation({
    mutationFn: () => updateBookingStatus(bookingId, { status: 'booked', ...branchScope }),
    onSuccess: done('بقيت الخدمات في موعدها الأصلي.'),
    onError: failed,
  });
  const move = useMutation({
    mutationFn: (scheduledAt: string) => rescheduleBooking(bookingId, { ...branchScope, scheduledAt }),
    onSuccess: done('تم نقل الخدمات المتبقية إلى الموعد الجديد.'),
    onError: failed,
  });
  const cancel = useMutation({
    mutationFn: ({ serviceIds, refund }: { serviceIds: number[]; refund?: BookingRefundInput | undefined }) => (
      cancelBookingServices(bookingId, { ...branchScope, serviceIds, ...(refund ? { refund } : {}) })
    ),
    onSuccess: done('تم إلغاء الخدمات المتبقية.'),
    onError: failed,
  });

  const data = booking.data;
  const waiting = data?.services.filter((service) => service.status === 'pending') ?? [];
  // Right after the sale the cached booking still lists the services just sold;
  // the choice is offered only on the reloaded booking.
  if (booking.isFetching || !data || data.status !== 'arrived' || waiting.length === 0) return null;
  const waitingIds = waiting.map((service) => service.serviceId);
  const pending = keep.isPending || move.isPending || cancel.isPending;

  if (step === 'move') {
    return (
      <RescheduleDialog
        dismissible={false}
        pending={move.isPending}
        onSubmit={(scheduledAt) => move.mutate(scheduledAt)}
        onClose={() => setStep('choose')}
      />
    );
  }
  if (step === 'cancel') {
    const amount = excessAfterCancelling(data, waitingIds);
    return (
      <BookingRefundConfirm
        key={amount}
        title="إلغاء الخدمات المتبقية"
        description="ستُلغى الخدمات التي لم تُبع من هذا الحجز."
        confirmLabel="تأكيد إلغاء الخدمات المتبقية"
        amount={amount}
        cashierSessionId={cashierSessionId}
        pending={cancel.isPending}
        onConfirm={(refund) => cancel.mutate({ serviceIds: waitingIds, refund })}
        onCancel={() => setStep('choose')}
      />
    );
  }
  return (
    <Modal title="خدمات الحجز المتبقية" dismissOnBackdrop={false} onClose={() => undefined}>
      <p className="text-[13px] text-muted">لم تُبع هذه الخدمات بعد. اختر ما يحدث لها قبل المتابعة:</p>
      <ul className="space-y-1 text-sm">
        {waiting.map((service) => (
          <li key={service.serviceId} className="rounded-control border border-line px-3 py-2">
            {service.serviceName}
            {service.servicePrice !== null ? <span className="tabular text-muted"> • {service.servicePrice} ج</span> : null}
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex flex-col gap-2">
        <Button disabled={pending} onClick={() => keep.mutate()}>إبقاء في الموعد الأصلي</Button>
        <Button variant="secondary" disabled={pending} onClick={() => setStep('move')}>تغيير الموعد</Button>
        <Button variant="danger" disabled={pending} onClick={() => setStep('cancel')}>إلغاء الخدمات المتبقية</Button>
      </div>
    </Modal>
  );
}

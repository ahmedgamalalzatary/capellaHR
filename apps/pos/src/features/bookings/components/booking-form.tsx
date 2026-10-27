'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { exactMoneySchema, type PaymentMethod, type BookingRefundInput } from '@capella/contracts';

import { Button, Input, Label, Modal } from '@capella/ui';
import { Select } from '@/components/form/select';

import { ClientPicker, type Client } from '@/features/clients';
import { ServicePicker, type ServiceListItem } from '@/features/catalog';
import { ApiError } from '@/lib/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import { createUuid } from '@/lib/uuid';
import { bookingPaymentMethods } from '../booking-money';

import { createBooking, updateBooking, listBookingEmployeeOptions } from '../api/bookings-api';
import type { BookingDto } from '../api/bookings-api';
import { BookingTicket } from './booking-ticket';
import { BookingRefundConfirm } from './booking-money-dialogs';

export const cairoDateTimeToIso = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const naive = Date.parse(`${value}:00Z`);
  if (Number.isNaN(naive)) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  // Search the valid offset range so gaps produce no candidate and repeated
  // times deterministically choose the earlier instant.
  const candidates: Date[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 1) {
    const candidate = new Date(naive - offsetMinutes * 60_000);
    const parts = formatter.formatToParts(candidate).reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    const represented = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (represented === value) candidates.push(candidate);
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0]?.toISOString() ?? null;
};

export const mapBookingSaveError = (error: unknown): unknown =>
  error instanceof Error && error.message === 'Invalid Cairo local time'
    ? new Error('الوقت المحلي غير صالح.')
    : error;

export function BookingForm({ booking, branchId, cashierSessionId = null, onClose, onSaved }: {
  booking?: BookingDto;
  branchId?: number;
  cashierSessionId?: number | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [client, setClient] = useState<Client | null>(() => booking ? { ...booking.client, branchId: booking.branchId, createdAt: booking.createdAt, updatedAt: booking.updatedAt } : null);
  const [services, setServices] = useState<ServiceListItem[]>(() => booking?.services.filter((service) => service.status !== 'cancelled').map((service) => ({ id: service.serviceId, branchId: booking.branchId, categoryId: 0, categoryName: '', categoryIsActive: true, name: service.serviceName, price: service.servicePrice, description: null, commissionPercent: '0.00', isActive: true, createdAt: '', updatedAt: '' })) ?? []);
  const [preferences, setPreferences] = useState<Record<number, number | undefined>>(() => Object.fromEntries(booking?.services.map((service) => [service.serviceId, service.preferredEmployee?.id]) ?? []));
  const [scheduledAt, setScheduledAt] = useState(() => booking ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(booking.scheduledAt)).replace(' ', 'T') : '');
  const [note, setNote] = useState(booking?.note ?? '');
  const [refundAmount, setRefundAmount] = useState<string>();
  const [saved, setSaved] = useState<BookingDto>();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const identity = useRef<{ fingerprint: string; reference: string } | null>(null);
  const parsedAmount = exactMoneySchema.safeParse(amount.trim() || '0');
  const amountCents = parsedAmount.success ? BigInt(parsedAmount.data.replace('.', '')) : null;
  const totalCents = services.reduce((sum, service) => sum + BigInt((service.price ?? '0.00').replace('.', '')), BigInt(0));
  const paymentValid = amountCents !== null && amountCents <= totalCents
    && (amountCents === BigInt(0) || cashierSessionId !== null);
  const total = `${totalCents / BigInt(100)}.${String(totalCents % BigInt(100)).padStart(2, '0')}`;
  const employees = useQuery({
    queryKey: ['erp-bookings', 'employee-options', branchId ?? 'own'],
    queryFn: () => listBookingEmployeeOptions(branchId),
  });
  const save = useMutation({
    mutationFn: (refund?: BookingRefundInput) => {
      const scheduledAtIso = cairoDateTimeToIso(scheduledAt);
      if (scheduledAtIso === null) throw new Error('Invalid Cairo local time');
      if (!paymentValid) throw new Error('Invalid payment');
      const payload = {
        ...(branchId === undefined ? {} : { branchId }),
        clientId: client!.id,
        scheduledAt: scheduledAtIso,
        services: services.map(({ id }) => ({
          serviceId: id,
          ...(preferences[id] === undefined ? {} : { preferredEmployeeId: preferences[id] }),
        })),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(!booking && amountCents !== BigInt(0) && parsedAmount.success && cashierSessionId !== null
          ? { initialPayment: { cashierSessionId, method, amount: parsedAmount.data } } : {}),
      };
      if (booking) return updateBooking(booking.id, { ...payload, note: note.trim() || null, expectedUpdatedAt: booking.updatedAt, ...(refund ? { refund } : {}) });
      const fingerprint = JSON.stringify(payload);
      if (identity.current?.fingerprint !== fingerprint) identity.current = { fingerprint, reference: createUuid() };
      return createBooking({ ...payload, operationReference: identity.current.reference });
    },
    onSuccess: async (value) => { if (!booking) setSaved(value); notifySuccess(booking ? 'تم تعديل الحجز.' : 'تم إنشاء الحجز.'); await onSaved(); if (booking) onClose(); },
    onError: (error: unknown) => {
      if (booking && error instanceof ApiError && error.code === 'BOOKING_REFUND_REQUIRED' && error.amount) { setRefundAmount(error.amount); return; }
      notifyError(mapBookingSaveError(error), 'تعذر حفظ الحجز.');
    },
  });
  if (refundAmount) return <BookingRefundConfirm amount={refundAmount} title="رد مقدم الحجز قبل التعديل" description="يجب إعادة هذا المبلغ للعميل الأصلي قبل حفظ التعديلات." confirmLabel="حفظ التعديلات" cashierSessionId={cashierSessionId} pending={save.isPending} onConfirm={(refund) => save.mutate(refund)} onCancel={() => { if (!save.isPending) setRefundAmount(undefined); }} />;
  if (saved) return <Modal title="تذكرة الموعد" onClose={onClose}>
    <div className="space-y-4"><BookingTicket booking={saved} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>إغلاق</Button><Button onClick={() => window.print()}>طباعة التذكرة</Button></div></div>
  </Modal>;
  return <Modal title={booking ? 'تعديل الحجز' : 'حجز موعد جديد'} dismissOnBackdrop={!save.isPending} onClose={() => { if (!save.isPending) onClose(); }} className="max-h-[90dvh] max-w-2xl overflow-y-auto">
    <fieldset disabled={save.isPending} className="space-y-4">
      <fieldset disabled={booking?.services.some((service) => service.status === 'sold')}><ClientPicker selected={client} onSelect={setClient} {...(branchId === undefined ? {} : { branchId })} /></fieldset>
      <ServicePicker {...(branchId === undefined ? {} : { branchId })} onSelect={(service) => setServices((current) => current.some(({ id }) => id === service.id) ? current : [...current, service])} />
      {services.map((service) => <div key={service.id} className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-[1fr_16rem_auto] sm:items-center">
        <span>{service.name}</span>
        <Select disabled={booking?.services.some((line) => line.serviceId === service.id && line.status === 'sold')} aria-label={`الموظف المفضل لخدمة ${service.name}`} value={preferences[service.id] ?? ''} onChange={(event) => setPreferences((current) => ({ ...current, [service.id]: event.target.value ? Number(event.target.value) : undefined }))}>
          <option value="">بدون موظف مفضل</option>
          {employees.data?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </Select>
        <Button disabled={booking?.services.some((line) => line.serviceId === service.id && line.status === 'sold')} variant="ghost" aria-label={`حذف ${service.name}`} onClick={() => setServices((current) => current.filter(({ id }) => id !== service.id))}><Trash2 className="size-4" /></Button>
      </div>)}
      <div className="space-y-1.5"><Label htmlFor="booking-time">التاريخ والوقت</Label><Input id="booking-time" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="booking-note">ملاحظة</Label><Input id="booking-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      {!booking ? <div className="space-y-3 rounded-control border border-line p-3">
        <p className="text-sm">إجمالي الخدمات محددة السعر: {total} ج.م</p>
        <p className="text-xs text-muted">الخدمات بدون سعر محدد تُحاسب عند البيع.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="booking-initial-method">طريقة الدفع المقدم</Label><Select id="booking-initial-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{bookingPaymentMethods.map((option) => <option key={option.method} value={option.method}>{option.label}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="booking-initial-amount">مبلغ الدفع المقدم</Label><Input id="booking-initial-amount" inputMode="decimal" value={amount} placeholder="بدون دفع مقدم" onChange={(event) => setAmount(event.target.value)} /></div>
        </div>
        <Button size="sm" variant="secondary" disabled={cashierSessionId === null || totalCents === BigInt(0)} onClick={() => setAmount(total)}>دفع كامل المبلغ</Button>
        {cashierSessionId === null ? <p className="text-xs text-warning">افتح وردية لتسجيل دفع مقدم.</p> : null}
        {!paymentValid ? <p className="text-sm text-danger">أدخل مبلغًا صحيحًا لا يتجاوز قيمة الخدمات، مع وردية مفتوحة عند الدفع.</p> : null}
      </div> : <p className="text-sm text-muted">تظل الخدمات المباعة محفوظة. تغيير العميل يتطلب رد المقدم أولًا، ولا يتاح بعد إصدار فاتورة.</p>}
      {save.isError ? <p role="alert" className="text-sm text-danger">{save.error instanceof ApiError ? save.error.message : save.error instanceof Error && save.error.message === 'Invalid Cairo local time' ? 'الوقت المحلي غير صالح.' : 'تعذر حفظ الحجز.'}</p> : null}
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={save.isPending} onClick={onClose}>إغلاق</Button><Button disabled={!client || !scheduledAt || services.length === 0 || !paymentValid || save.isPending} onClick={() => save.mutate(undefined)}>{booking ? 'حفظ التعديلات' : 'حفظ الحجز'}</Button></div>
    </fieldset>
  </Modal>;
}

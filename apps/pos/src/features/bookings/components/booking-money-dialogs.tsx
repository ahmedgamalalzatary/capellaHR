'use client';

import type { BookingRefundInput, PaymentMethod } from '@capella/contracts';
import { useState } from 'react';

import { Button, Input, Label, Modal } from '@capella/ui';

import { Select } from '@/components/form/select';
import { createUuid } from '@/lib/uuid';

import {
  bookingPaymentMethods,
  emptyRefundSplit,
  refundPaymentsFor,
  type RefundSplit,
} from '../booking-money';
import { cairoDateTimeToIso } from './booking-form';

const isOwed = (amount: string) => amount !== '0.00';

/**
 * How the money owed back leaves the drawer: all cash by default, split across
 * methods when the cashier wants. It must add up exactly to the amount owed.
 */
export function RefundSplitFields({ amount, split, onChange }: {
  amount: string;
  split: RefundSplit;
  onChange: (next: RefundSplit) => void;
}) {
  return (
    <div className="space-y-2 rounded-control border border-warning/30 bg-warning-soft p-3">
      <p className="text-sm font-medium text-warning">سيتم رد {amount} ج.م للعميل من الدرج</p>
      <div className="grid grid-cols-2 gap-2">
        {bookingPaymentMethods.map(({ method, label }) => (
          <div key={method} className="space-y-1">
            <Label htmlFor={`refund-${method}`}>{label}</Label>
            <Input
              id={`refund-${method}`}
              aria-label={`رد ${label}`}
              inputMode="decimal"
              className="text-start"
              value={split[method]}
              onChange={(event) => onChange({ ...split, [method]: event.target.value })}
            />
          </div>
        ))}
      </div>
      {refundPaymentsFor(split, amount) === null ? (
        <p className="text-[13px] text-danger">يجب أن يساوي مجموع الرد {amount} ج.م بالضبط.</p>
      ) : null}
    </div>
  );
}

export const useRefundSplit = (amount: string) => {
  const [split, setSplit] = useState<RefundSplit>(() => ({ ...emptyRefundSplit(), cash: amount }));
  // One reference per opened dialog: a retry after a dropped connection resends
  // it, so the server replays instead of refunding twice.
  const [operationReference] = useState(createUuid);
  return { split, setSplit, operationReference };
};

/**
 * Confirms a cancellation. When held money is owed back the cashier names how it
 * leaves the drawer, and that needs an open shift.
 */
export function BookingRefundConfirm({
  title,
  description,
  confirmLabel,
  amount,
  cashierSessionId,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  amount: string;
  cashierSessionId: number | null;
  pending: boolean;
  onConfirm: (refund: BookingRefundInput | undefined) => void;
  onCancel: () => void;
}) {
  const { split, setSplit, operationReference } = useRefundSplit(amount);
  const owed = isOwed(amount);
  const payments = owed ? refundPaymentsFor(split, amount) : null;
  const blocked = owed && (payments === null || cashierSessionId === null);
  return (
    <Modal title={title} dismissOnBackdrop={!pending} onClose={onCancel}>
      <p className="text-[13px] text-muted">{description}</p>
      {owed ? <RefundSplitFields amount={amount} split={split} onChange={setSplit} /> : null}
      {owed && cashierSessionId === null ? (
        <p role="alert" className="text-[13px] text-danger">افتح وردية أولًا لرد المال من الدرج.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={pending || blocked}
          onClick={() => onConfirm(owed && payments && cashierSessionId !== null
            ? { cashierSessionId, payments, operationReference }
            : undefined)}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>رجوع</Button>
      </div>
    </Modal>
  );
}

const amountCents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

/** Money paid before the services, never above what the waiting services are still worth. */
export function BookingPaymentDialog({ maxPayable, pending, onSubmit, onClose }: {
  maxPayable: string;
  pending: boolean;
  onSubmit: (input: { method: PaymentMethod; amount: string; operationReference: string }) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [operationReference] = useState(createUuid);
  const cents = amountCents(amount.trim());
  const limit = amountCents(maxPayable) ?? BigInt(0);
  const valid = cents !== null && cents > BigInt(0) && cents <= limit;
  const normalized = cents === null
    ? ''
    : `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, '0')}`;
  return (
    <Modal title="دفع مقدم" dismissOnBackdrop={!pending} onClose={onClose}>
      <p className="text-[13px] text-muted">الحد الأقصى المتاح: {maxPayable} ج.م</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="booking-payment-method">طريقة الدفع</Label>
          <Select
            id="booking-payment-method"
            aria-label="طريقة الدفع المقدم"
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {bookingPaymentMethods.map((option) => (
              <option key={option.method} value={option.method}>{option.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booking-payment-amount">المبلغ</Label>
          <Input
            id="booking-payment-amount"
            aria-label="مبلغ الدفع المقدم"
            inputMode="decimal"
            className="text-start"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </div>
      {cents !== null && cents > limit ? (
        <p role="alert" className="text-[13px] text-danger">لا يمكن أن يتجاوز المقدم {maxPayable} ج.م.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || !valid}
          onClick={() => onSubmit({ method, amount: normalized, operationReference })}
        >
          تسجيل الدفع
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>إغلاق</Button>
      </div>
    </Modal>
  );
}

/** Moves the waiting services to a new appointment; the booking returns to booked. */
export function RescheduleDialog({ pending, onSubmit, onClose, dismissible = true }: {
  pending: boolean;
  onSubmit: (scheduledAt: string) => void;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const [value, setValue] = useState('');
  const iso = cairoDateTimeToIso(value);
  return (
    <Modal title="تغيير الموعد" dismissOnBackdrop={dismissible && !pending} onClose={onClose}>
      <div className="space-y-1.5">
        <Label htmlFor="booking-new-time">الموعد الجديد</Label>
        <Input
          id="booking-new-time"
          type="datetime-local"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      {value && iso === null ? <p role="alert" className="text-[13px] text-danger">الوقت المحلي غير صالح.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || iso === null} onClick={() => iso && onSubmit(iso)}>حفظ الموعد</Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>رجوع</Button>
      </div>
    </Modal>
  );
}

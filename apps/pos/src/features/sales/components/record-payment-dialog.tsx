'use client';

import type { PaymentMethod, PublicInvoiceDto } from '@capella/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Input, Label, Modal } from '@capella/ui';

import { createUuid } from '@/lib/uuid';

import { recordInvoicePayment } from '../api/sales-api';
import { responseMessage } from './invoice-format';
import { PaymentReceipt } from './payment-receipt';

const methods: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'نقدي' },
  { value: 'visa', label: 'فيزا' },
  { value: 'instapay', label: 'إنستاباي' },
  { value: 'vodafone_cash', label: 'فودافون كاش' },
];

const cents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

export function RecordPaymentDialog({
  invoice,
  branchId,
  cashierSessionId,
  onClose,
  onUpdated,
}: {
  invoice: PublicInvoiceDto;
  branchId?: number;
  cashierSessionId: number;
  onClose(): void;
  onUpdated(invoice: PublicInvoiceDto): void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [operationReference] = useState(createUuid);
  const [updatedInvoice, setUpdatedInvoice] = useState<PublicInvoiceDto | null>(null);
  const amountCents = cents(amount);
  const balanceCents = cents(invoice.totals.balanceDue)!;
  const valid = amountCents !== null && amountCents > BigInt(0) && amountCents <= balanceCents;
  const mutation = useMutation({
    mutationFn: () => recordInvoicePayment(invoice.id, {
      ...(branchId === undefined ? {} : { branchId }),
      cashierSessionId,
      method,
      amount,
      operationReference,
    }),
    onSuccess: (updated) => {
      onUpdated(updated);
      setUpdatedInvoice(updated);
    },
  });

  if (updatedInvoice) return <Modal title="إيصال دفعة" onClose={onClose}>
    <PaymentReceipt
      invoice={updatedInvoice}
      method={method}
      amount={amount}
      operationReference={operationReference}
    />
    <div data-print-controls className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onClose}>إغلاق</Button>
      <Button onClick={() => window.print()}>طباعة إيصال الدفعة</Button>
    </div>
  </Modal>;

  return <Modal title="تسجيل دفعة" onClose={onClose}>
    <p className="text-sm">الرصيد المستحق: {invoice.totals.balanceDue} ج.م</p>
    <label className="block space-y-1 text-sm">
      <span>طريقة الدفع</span>
      <select
        aria-label="طريقة الدفع"
        className="h-10 w-full rounded-control border border-line bg-paper px-3"
        value={method}
        onChange={(event) => setMethod(event.target.value as PaymentMethod)}
      >
        {methods.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
    </label>
    <div className="space-y-1">
      <Label htmlFor="invoice-payment-amount">المبلغ</Label>
      <Input
        id="invoice-payment-amount"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
    </div>
    {amountCents !== null && amountCents > balanceCents
      ? <p role="alert" className="text-sm text-danger">الدفعة أكبر من الرصيد المستحق.</p>
      : null}
    {mutation.isError
      ? <p role="alert" className="text-sm text-danger">{responseMessage(mutation.error, 'تعذر تسجيل الدفعة.')}</p>
      : null}
    <div className="flex justify-end gap-2">
      <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>إلغاء</Button>
      <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'جارٍ التسجيل…' : 'تسجيل وطباعة الدفعة'}
      </Button>
    </div>
  </Modal>;
}

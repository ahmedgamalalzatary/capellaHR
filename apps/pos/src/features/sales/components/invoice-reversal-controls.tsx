'use client';

import type { PaymentMethod, PublicInvoiceDto, RefundQuote } from '@capella/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { Button, Card, CardContent, Input } from '@capella/ui';

import { Textarea } from '@/components/form/textarea';
import { createUuid } from '@/lib/uuid';

import { quoteRefund, refundInvoice, voidInvoice } from '../api/sales-api';
import { formatCairoDateTime, paymentLabels, responseMessage } from './invoice-format';

const cents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

export function InvoiceReversalControls({
  invoice,
  branchId,
  onUpdated,
}: {
  invoice: PublicInvoiceDto;
  branchId?: number;
  onUpdated(invoice: PublicInvoiceDto): void;
}) {
  const [mode, setMode] = useState<'refund' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [paymentAmounts, setPaymentAmounts] = useState<Record<PaymentMethod, string>>({
    cash: '', visa: '', instapay: '', vodafone_cash: '',
  });
  const [quoted, setQuoted] = useState<RefundQuote | null>(null);
  const commandIdentity = useRef<{ fingerprint: string; key: string } | null>(null);
  const idempotencyKeyFor = (payload: unknown) => {
    const fingerprint = JSON.stringify(payload);
    if (commandIdentity.current?.fingerprint !== fingerprint) {
      commandIdentity.current = { fingerprint, key: createUuid() };
    }
    return commandIdentity.current.key;
  };
  const selectedLines = invoice.lines.flatMap((line) => {
    const quantity = Number(quantities[line.id] ?? 0);
    return Number.isInteger(quantity) && quantity > 0 && quantity <= line.refundableQuantity
      ? [{ invoiceLineId: line.id, quantity }]
      : [];
  });
  const hasInvalidQuantity = invoice.lines.some((line) => {
    const raw = quantities[line.id];
    if (raw === undefined || raw === '') return false;
    const quantity = Number(raw);
    return quantity !== 0 && (!Number.isInteger(quantity)
      || quantity < 0 || quantity > line.refundableQuantity);
  });
  const quote = useMutation({
    mutationFn: () => quoteRefund(invoice.id, {
      ...(branchId === undefined ? {} : { branchId }), lines: selectedLines,
    }),
    onSuccess: (value) => {
      setQuoted(value);
      setPaymentAmounts({ cash: '', visa: '', instapay: '', vodafone_cash: '' });
    },
  });
  const refund = useMutation({
    mutationFn: () => {
      const payload = {
        ...(branchId === undefined ? {} : { branchId }),
        reason: reason.trim(),
        lines: selectedLines,
        payments: quoted!.payments.flatMap((payment) => {
          const amount = paymentAmounts[payment.method].trim();
          return cents(amount) && cents(amount)! > BigInt(0) ? [{ method: payment.method, amount }] : [];
        }),
      };
      return refundInvoice(invoice.id, {
        ...payload,
        idempotencyKey: idempotencyKeyFor(payload),
      });
    },
    onSuccess: (value) => { onUpdated(value); close(true); },
  });
  const voidMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...(branchId === undefined ? {} : { branchId }),
        reason: reason.trim(),
      };
      return voidInvoice(invoice.id, {
        ...payload,
        idempotencyKey: idempotencyKeyFor(payload),
      });
    },
    onSuccess: (value) => { onUpdated(value); close(true); },
  });
  const reversalPending = refund.isPending || voidMutation.isPending;
  function close(requestSettled = false) {
    if (reversalPending && !requestSettled) return;
    setMode(null);
    setReason('');
    setQuantities({});
    setPaymentAmounts({ cash: '', visa: '', instapay: '', vodafone_cash: '' });
    setQuoted(null);
    commandIdentity.current = null;
    quote.reset();
    refund.reset();
    voidMutation.reset();
  }
  function openMode(nextMode: 'refund' | 'void') {
    if (reversalPending) return;
    close();
    setMode(nextMode);
  }
  const tenderTotal = quoted?.payments.reduce(
    (sum, payment) => sum + (cents(paymentAmounts[payment.method].trim()) ?? BigInt(0)), BigInt(0),
  ) ?? BigInt(0);
  const tenderValid = quoted !== null
    && tenderTotal === cents(quoted.totals.total)
    && quoted.payments.every((payment) => (
      (cents(paymentAmounts[payment.method].trim()) ?? BigInt(0)) <= cents(payment.refundableAmount)!
    ));
  const error = quote.error ?? refund.error ?? voidMutation.error;

  return <div data-print-controls className="mx-auto w-full max-w-2xl space-y-3">
    <div className="flex flex-wrap gap-2">
      {invoice.eligibility.canRefund ? <Button variant="secondary" disabled={reversalPending} onClick={() => openMode('refund')}>استرداد</Button> : null}
      {invoice.eligibility.canVoid ? <Button variant="secondary" disabled={reversalPending} onClick={() => openMode('void')}>إلغاء الفاتورة</Button> : null}
    </div>
    {mode === 'refund' ? <Card className="shadow-card"><CardContent className="space-y-4 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink">استرداد جزئي أو كامل</h2>
      <div className="space-y-2">{invoice.lines.filter((line) => line.refundableQuantity > 0).map((line) => <label key={line.id} className="grid items-center gap-2 rounded-control border border-line bg-surface/50 p-3 sm:grid-cols-[1fr_8rem]">
        <span className="text-sm">{line.name} · متبقي {line.refundableQuantity}</span>
        <Input aria-label={`كمية استرداد ${line.name}`} type="number" min={0} max={line.refundableQuantity} disabled={quote.isPending} dir="ltr" className="text-start" value={quantities[line.id] ?? ''} onChange={(event) => { setQuantities((current) => ({ ...current, [line.id]: event.target.value })); setQuoted(null); }} />
      </label>)}</div>
      <Button disabled={!selectedLines.length || hasInvalidQuantity || quote.isPending} onClick={() => quote.mutate()}>{quote.isPending ? 'جارٍ الحساب…' : 'احسب الاسترداد'}</Button>
      {quoted ? <div className="space-y-3 rounded-control border border-line bg-surface/50 p-3">
        <p className="font-semibold">الإجمالي المسترد: <span className="tabular" dir="ltr">{quoted.totals.total} ج.م</span></p>
        {quoted.payments.map((payment) => <label key={payment.method} className="grid items-center gap-2 sm:grid-cols-[1fr_10rem]">
          <span className="text-sm">{paymentLabels[payment.method]} · متاح {payment.refundableAmount} ج.م</span>
          <Input aria-label={`مبلغ الاسترداد ${paymentLabels[payment.method]}`} inputMode="decimal" dir="ltr" className="bg-paper text-start" value={paymentAmounts[payment.method]} onChange={(event) => setPaymentAmounts((current) => ({ ...current, [payment.method]: event.target.value }))} />
        </label>)}
        <label className="grid gap-1.5"><span className="text-sm font-medium text-ink">سبب الاسترداد</span><Textarea aria-label="سبب الاسترداد" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><Button disabled={!reason.trim() || !tenderValid || refund.isPending} onClick={() => refund.mutate()}>{refund.isPending ? 'جارٍ الاسترداد…' : 'تأكيد الاسترداد'}</Button><Button variant="ghost" disabled={reversalPending} onClick={() => close()}>رجوع</Button></div>
      </div> : null}
    </CardContent></Card> : null}
    {mode === 'void' ? <Card className="shadow-card"><CardContent className="space-y-3 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink">إلغاء الفاتورة بالكامل</h2>
      <p className="text-[13px] text-muted">سيتم عكس كل البنود والمدفوعات والمخزون والعمولة.</p>
      <label className="grid gap-1.5"><span className="text-sm font-medium text-ink">سبب الإلغاء</span><Textarea aria-label="سبب الإلغاء" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={!reason.trim() || voidMutation.isPending} onClick={() => voidMutation.mutate()}>{voidMutation.isPending ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}</Button><Button variant="ghost" disabled={reversalPending} onClick={() => close()}>رجوع</Button></div>
    </CardContent></Card> : null}
    {error ? <p role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">{responseMessage(error)}</p> : null}
    {invoice.reversals.length ? <Card className="shadow-card"><CardContent className="space-y-3 p-4 sm:p-5"><h2 className="text-sm font-semibold text-ink">سجل الإلغاء والاسترداد</h2>{invoice.reversals.map((reversal) => <div key={reversal.id} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0"><p className="font-medium">{reversal.type === 'void' ? 'إلغاء كامل' : 'استرداد'} · {reversal.totals.total} ج.م</p><p className="text-[13px] text-muted">{reversal.reason}</p><ul className="space-y-0.5 text-[13px]">{reversal.lines.map((line) => <li key={line.invoiceLineId}>{line.name} × {line.quantity} · {line.total} ج.م</li>)}</ul>{reversal.payments.length ? <ul className="space-y-0.5 text-[13px]">{reversal.payments.map((payment) => <li key={payment.method}>{paymentLabels[payment.method]} · {payment.amount} ج.م</li>)}</ul> : <p className="text-[13px]">لا توجد حركة دفع لهذا الاسترداد</p>}<p className="text-xs text-muted">{reversal.actingAccount.username} · {formatCairoDateTime(reversal.createdAt)}</p></div>)}</CardContent></Card> : null}
  </div>;
}

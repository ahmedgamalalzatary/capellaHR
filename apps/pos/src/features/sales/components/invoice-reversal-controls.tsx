'use client';

import type { PublicInvoiceDto, RefundQuote } from '@capella/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { Button, Input, Modal } from '@capella/ui';

import { Textarea } from '@/components/form/textarea';
import { createUuid } from '@/lib/uuid';

import { quoteRefund, refundInvoice, voidInvoice } from '../api/sales-api';
import { formatCairoDateTime, paymentLabels, responseMessage } from './invoice-format';

const cents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

const money = (value: bigint) => `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, '0')}`;

/**
 * Handing the cash back is a counter gesture, not a decision: the refund always goes
 * back on the methods the client paid with. The tender split is therefore derived from
 * the quote instead of typed, and the API still checks the totals it receives.
 */
const allocateTenders = (quote: RefundQuote) => {
  let remaining = cents(quote.totals.total);
  if (remaining === null) return null;
  const tenders: Array<{ method: RefundQuote['payments'][number]['method']; amount: string }> = [];
  for (const payment of quote.payments) {
    if (remaining === BigInt(0)) break;
    const refundable = cents(payment.refundableAmount);
    if (refundable === null) return null;
    const taken = refundable < remaining ? refundable : remaining;
    if (taken > BigInt(0)) tenders.push({ method: payment.method, amount: money(taken) });
    remaining -= taken;
  }
  return remaining === BigInt(0) ? tenders : null;
};

export function InvoiceReversalControls({
  invoice,
  branchId,
  onUpdated,
  showRefundAction = true,
}: {
  invoice: PublicInvoiceDto;
  branchId?: number;
  onUpdated(invoice: PublicInvoiceDto): void;
  /** The refunds tab owns refunding; the receipt page keeps void and history only. */
  showRefundAction?: boolean;
}) {
  const [mode, setMode] = useState<'refund' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
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
  const tenders = quoted === null ? null : allocateTenders(quoted);
  const quote = useMutation({
    mutationFn: () => quoteRefund(invoice.id, {
      ...(branchId === undefined ? {} : { branchId }), lines: selectedLines,
    }),
    onSuccess: (value) => setQuoted(value),
  });
  const refund = useMutation({
    mutationFn: () => {
      const payload = {
        ...(branchId === undefined ? {} : { branchId }),
        reason: reason.trim(),
        lines: selectedLines,
        payments: tenders ?? [],
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
  const tenderMessage = quoted !== null && tenders === null
    ? 'تعذر توزيع المبلغ المسترد على طرق الدفع المسجلة للفاتورة.'
    : null;
  const errorMessage = quote.error
    ? responseMessage(quote.error, 'تعذر حساب مبلغ الاسترداد.')
    : refund.error
      ? responseMessage(refund.error, 'تعذر تنفيذ الاسترداد.')
      : voidMutation.error
        ? responseMessage(voidMutation.error, 'تعذر إلغاء الفاتورة.')
        : null;

  return (
    <div data-print-controls className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {invoice.eligibility.canRefund && showRefundAction ? (
          <Button variant="secondary" disabled={reversalPending} onClick={() => openMode('refund')}>
            استرداد
          </Button>
        ) : null}
        {invoice.eligibility.canVoid ? (
          <Button variant="danger" disabled={reversalPending} onClick={() => openMode('void')}>
            إلغاء الفاتورة
          </Button>
        ) : null}
      </div>

      {errorMessage && mode === null ? (
        <p role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
          {errorMessage}
        </p>
      ) : null}

      {invoice.reversals.length ? (
        <details open className="rounded-control border border-line bg-surface/40">
          <summary className="cursor-pointer select-none px-3 py-2">
            <h2 className="inline text-sm font-semibold text-ink">سجل الإلغاء والاسترداد</h2>
            <span className="ms-1 text-[13px] text-muted">({invoice.reversals.length})</span>
          </summary>
          <div className="space-y-3 px-3 pb-3">
            {invoice.reversals.map((reversal) => (
              <div key={reversal.id} className="space-y-1.5 border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="font-medium">
                  {reversal.type === 'void' ? 'إلغاء كامل' : 'استرداد'} ·{' '}
                  <span className="tabular" dir="ltr">{reversal.totals.total} ج.م</span>
                </p>
                <p className="text-[13px] text-muted">{reversal.reason}</p>
                <ul className="space-y-0.5 text-[13px]">
                  {reversal.lines.map((line) => (
                    <li key={line.invoiceLineId}>{line.name} × {line.quantity} · {line.total} ج.م</li>
                  ))}
                </ul>
                {reversal.payments.length ? (
                  <ul className="space-y-0.5 text-[13px]">
                    {reversal.payments.map((payment) => (
                      <li key={payment.method}>{paymentLabels[payment.method]} · {payment.amount} ج.م</li>
                    ))}
                  </ul>
                ) : <p className="text-[13px]">لا توجد حركة دفع لهذا الاسترداد</p>}
                <p className="text-xs text-muted">
                  {reversal.actingAccount.username} · {formatCairoDateTime(reversal.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {mode === 'refund' ? (
        <Modal
          title="استرداد جزئي أو كامل"
          className="max-w-lg"
          dismissOnBackdrop={!reversalPending}
          onClose={() => close()}
        >
          <div className="space-y-2">
            {invoice.lines.filter((line) => line.refundableQuantity > 0).map((line) => (
              <label
                key={line.id}
                className="grid items-center gap-2 rounded-control border border-line bg-surface/50 p-3 sm:grid-cols-[1fr_7rem]"
              >
                <span className="text-sm">
                  {line.name}
                  <span className="block text-[13px] text-muted">متبقي {line.refundableQuantity}</span>
                </span>
                <Input
                  aria-label={`كمية استرداد ${line.name}`}
                  type="number"
                  min={0}
                  max={line.refundableQuantity}
                  disabled={quote.isPending}
                  dir="ltr"
                  className="text-start"
                  value={quantities[line.id] ?? ''}
                  onChange={(event) => {
                    setQuantities((current) => ({ ...current, [line.id]: event.target.value }));
                    setQuoted(null);
                  }}
                />
              </label>
            ))}
          </div>

          <Button
            className="w-full"
            disabled={!selectedLines.length || hasInvalidQuantity || quote.isPending}
            onClick={() => quote.mutate()}
          >
            {quote.isPending ? 'جارٍ الحساب…' : 'احسب الاسترداد'}
          </Button>

          {quoted ? (
            <div className="space-y-3 rounded-control border border-line bg-surface/50 p-3">
              <p className="flex items-baseline justify-between font-semibold">
                <span>الإجمالي المسترد</span>
                <span className="tabular text-lg" dir="ltr">{quoted.totals.total} ج.م</span>
              </p>
              {/* The split is shown, not asked for: the money returns the way it came in. */}
              <ul className="space-y-1 text-[13px] text-muted">
                {(tenders ?? []).map((tender) => (
                  <li key={tender.method} className="flex items-baseline justify-between">
                    <span>يُرد عبر {paymentLabels[tender.method]}</span>
                    <span className="tabular" dir="ltr">{tender.amount} ج.م</span>
                  </li>
                ))}
              </ul>
              {tenderMessage ? <p role="alert" className="text-[13px] text-danger">{tenderMessage}</p> : null}
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-ink">سبب الاسترداد</span>
                <Textarea
                  aria-label="سبب الاسترداد"
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={reversalPending} onClick={() => close()}>رجوع</Button>
            <Button
              disabled={!reason.trim() || tenders === null || refund.isPending}
              onClick={() => refund.mutate()}
            >
              {refund.isPending ? 'جارٍ الاسترداد…' : 'تأكيد الاسترداد'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {mode === 'void' ? (
        <Modal
          title="إلغاء الفاتورة بالكامل"
          className="max-w-lg"
          dismissOnBackdrop={!reversalPending}
          onClose={() => close()}
        >
          <p className="text-[13px] text-muted">سيتم عكس كل البنود والمدفوعات والمخزون والعمولة.</p>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">سبب الإلغاء</span>
            <Textarea
              aria-label="سبب الإلغاء"
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {errorMessage ? (
            <p role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={reversalPending} onClick={() => close()}>رجوع</Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || voidMutation.isPending}
              onClick={() => voidMutation.mutate()}
            >
              {voidMutation.isPending ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

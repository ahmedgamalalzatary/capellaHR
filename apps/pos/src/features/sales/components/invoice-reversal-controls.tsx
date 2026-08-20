'use client';

import type { PaymentMethod, PublicInvoiceDto, RefundQuote } from '@capella/contracts';
import { useMutation } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button, Input, Modal } from '@capella/ui';

import { DraftNotice } from '@/components/feedback/draft-notice';
import { Textarea } from '@/components/form/textarea';
import { useFormDraft } from '@/lib/form-draft';
import { createUuid } from '@/lib/uuid';

import { quoteRefund, refundInvoice, voidInvoice } from '../api/sales-api';
import { formatCairoDateTime, paymentLabels, responseMessage } from './invoice-format';
import { RefundReceipt } from './refund-receipt';

const cents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

const money = (value: bigint) => `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, '0')}`;

/**
 * How the money physically goes back is the cashier's decision, not a derived fact:
 * a client who paid by card may want cash in hand. The split is therefore typed, and
 * this only proposes the ordinary answer — return it the way it came in — so the
 * common case stays one tap. Whatever the paid methods cannot cover is left for the
 * cashier to place.
 */
const proposeTenders = (quote: RefundQuote) => {
  let remaining = cents(quote.totals.total) ?? BigInt(0);
  const proposal: Partial<Record<PaymentMethod, string>> = {};
  for (const payment of quote.payments) {
    if (remaining === BigInt(0)) break;
    const refundable = cents(payment.refundableAmount);
    if (refundable === null || refundable === BigInt(0)) continue;
    const taken = refundable < remaining ? refundable : remaining;
    proposal[payment.method] = money(taken);
    remaining -= taken;
  }
  return proposal;
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
  const [tenderAmounts, setTenderAmounts] = useState<Partial<Record<PaymentMethod, string>>>({});
  /**
   * Asked once per stored refund: the money has already gone back, the slip the client
   * takes with them is optional.
   */
  const [refunded, setRefunded] = useState<PublicInvoiceDto | null>(null);
  const [printPrompt, setPrintPrompt] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
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
  const tenderMethods = quoted?.payments.map((payment) => payment.method) ?? [];
  const typedTenders = tenderMethods.flatMap((method) => {
    const raw = (tenderAmounts[method] ?? '').trim();
    if (raw === '') return [];
    const amount = cents(raw);
    return [{ method, amount }];
  });
  const hasInvalidTender = typedTenders.some(({ amount }) => amount === null);
  const tenders = hasInvalidTender ? null : typedTenders
    .flatMap(({ method, amount }) => (
      amount === null || amount === BigInt(0) ? [] : [{ method, amount: money(amount) }]
    ));
  const tenderTotal = typedTenders.reduce(
    (sum, { amount }) => sum + (amount ?? BigInt(0)),
    BigInt(0),
  );
  // A total we cannot read is not a total of zero: treating it as one would let an
  // empty split "balance" and post a refund of nothing.
  const quotedTotal = quoted === null ? null : cents(quoted.totals.total);
  const tenderDifference = quotedTotal === null ? null : tenderTotal - quotedTotal;
  const tendersBalance = !hasInvalidTender && tenderDifference === BigInt(0);
  /**
   * A reversal is typed against one invoice, so the memory is keyed by that
   * invoice: the quantities and the reason survive a trip to another tab.
   */
  const lastMode = useRef<'refund' | 'void'>('refund');
  if (mode !== null) lastMode.current = mode;
  const draft = useFormDraft(
    `reversal:${invoice.id}`,
    { mode: mode ?? lastMode.current, quantities, reason },
    reason.trim() !== '' || Object.values(quantities).some((value) => value !== ''),
  );
  const quote = useMutation({
    mutationFn: () => quoteRefund(invoice.id, {
      ...(branchId === undefined ? {} : { branchId }), lines: selectedLines,
    }),
    onSuccess: (value) => {
      setQuoted(value);
      setTenderAmounts(proposeTenders(value));
    },
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
        // What is being refunded identifies the command; how the money is handed
        // back does not. If the answer is lost after the till already paid out,
        // the cashier may well retry with the split moved to another method, and
        // that retry has to replay the stored refund instead of posting a second.
        idempotencyKey: idempotencyKeyFor({
          branchId, reason: payload.reason, lines: payload.lines,
        }),
      });
    },
    onSuccess: (value) => {
      onUpdated(value);
      close(true);
      setPrintError(null);
      if (value.reversals.length) {
        setRefunded(value);
        setPrintPrompt(true);
      }
    },
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
    // Closing the dialog is not abandoning the reversal: only a stored one, or an
    // explicit تجاهل, retires the draft. A backdrop click leaves the typed
    // quantities and reason exactly where they were.
    if (requestSettled) {
      draft.clear();
      setReason('');
      setQuantities({});
    }
    setMode(null);
    setQuoted(null);
    setTenderAmounts({});
    commandIdentity.current = null;
    quote.reset();
    refund.reset();
    voidMutation.reset();
  }
  function openMode(nextMode: 'refund' | 'void') {
    if (reversalPending) return;
    close();
    setRefunded(null);
    setPrintPrompt(false);
    setPrintError(null);
    setMode(nextMode);
  }
  /** The note is printed by the browser, so the counter printer needs no extra driver. */
  const printRefundNote = () => {
    setPrintError(null);
    if (typeof window.print !== 'function') {
      setPrintError('الطباعة غير متاحة في هذا المتصفح. افتح الفاتورة واطبع الإيصال من صفحتها.');
      return;
    }
    try {
      window.print();
    } catch {
      setPrintError('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح والطابعة ثم حاول مرة أخرى.');
    }
  };
  const printableReversal = refunded?.reversals.at(-1);
  const tenderMessage = quoted === null || tendersBalance
    ? null
    : hasInvalidTender
      ? 'اكتب مبلغًا صحيحًا لكل طريقة دفع.'
      : tenderDifference === null
        ? 'تعذر قراءة إجمالي الاسترداد. أعد الحساب.'
        : tenderDifference < BigInt(0)
          ? `متبقٍ للتوزيع ${money(-tenderDifference)} ج.م`
          : `زائد ${money(tenderDifference)} ج.م`;
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

      {draft.pending ? (
        <DraftNotice
          label="لديك مرتجع غير مكتمل لهذه الفاتورة."
          onRestore={() => {
            const stored = draft.restore();
            if (!stored) return;
            setMode(stored.mode);
            setQuantities(stored.quantities);
            setReason(stored.reason);
          }}
          onDiscard={draft.discard}
        />
      ) : null}

      {errorMessage && mode === null ? (
        <p role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
          {errorMessage}
        </p>
      ) : null}
      {printError ? (
        <p role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
          {printError}
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
                  <span className="tabular">{reversal.totals.total} ج.م</span>
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
                  className="text-start"
                  value={quantities[line.id] ?? ''}
                  onChange={(event) => {
                    setQuantities((current) => ({ ...current, [line.id]: event.target.value }));
                    setQuoted(null);
                    setTenderAmounts({});
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
                <span className="tabular text-lg">{quoted.totals.total} ج.م</span>
              </p>
              {/*
                Prefilled with the way the money came in, but the cashier decides where
                it actually goes back — a card sale may be refunded in cash.
              */}
              <div className="space-y-2">
                {tenderMethods.map((method) => (
                  <label
                    key={method}
                    className="grid items-center gap-2 sm:grid-cols-[1fr_8rem]"
                  >
                    <span className="text-[13px]">يُرد عبر {paymentLabels[method]}</span>
                    <Input
                      aria-label={`مبلغ الاسترداد ${paymentLabels[method]}`}
                      inputMode="decimal"
                      className="text-start"
                      value={tenderAmounts[method] ?? ''}
                      onChange={(event) => setTenderAmounts((current) => ({
                        ...current, [method]: event.target.value,
                      }))}
                    />
                  </label>
                ))}
              </div>
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
              disabled={!reason.trim() || !tendersBalance || refund.isPending}
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

      {/* Only the note reaches the paper; the print stylesheet hides everything else. */}
      {refunded && printableReversal ? (
        <div className="hidden print:block">
          <RefundReceipt invoice={refunded} reversal={printableReversal} />
        </div>
      ) : null}

      {printPrompt && printableReversal ? (
        <Modal title="طباعة إيصال الاسترداد" onClose={() => setPrintPrompt(false)}>
          <p className="text-sm">
            تم تنفيذ الاسترداد بمبلغ{' '}
            <span className="tabular font-semibold">{printableReversal.totals.total} ج.م</span>.
            هل تريد طباعة إيصال للعميل؟
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPrintPrompt(false)}>لا، شكراً</Button>
            <Button onClick={() => { setPrintPrompt(false); printRefundNote(); }}>
              <Printer className="size-4" aria-hidden />
              نعم، اطبع
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

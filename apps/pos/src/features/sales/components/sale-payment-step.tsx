'use client';

import type { PaymentMethod, SaleQuote } from '@capella/contracts';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { ApiError } from '@/lib/api/client';

import { errorMessage, money, paymentMethods, StepTitle } from './sale-primitives';

export function SalePaymentStep({
  step,
  hasLines,
  quotePending,
  quoteIsError,
  quoteError,
  quoteData,
  onRecalculateQuote,
  onRemoveServices,
  payments,
  onPaymentChange,
  remaining,
  completionError,
  ambiguous,
  storageError,
  ready,
  onSubmit,
}: {
  step: number;
  hasLines: boolean;
  quotePending: boolean;
  quoteIsError: boolean;
  quoteError: unknown;
  quoteData: SaleQuote | undefined;
  onRecalculateQuote: () => void;
  onRemoveServices: () => void;
  payments: Record<PaymentMethod, string>;
  onPaymentChange: (method: PaymentMethod, value: string) => void;
  remaining: bigint | null;
  completionError: unknown;
  ambiguous: boolean;
  storageError: boolean;
  ready: boolean;
  onSubmit: () => void;
}) {
  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle><StepTitle step={step} label="الإجمالي والمدفوعات" /></CardTitle></CardHeader>
      <CardContent className="space-y-4 p-5">
        {quotePending && hasLines ? (
          <LoadingState label="جارٍ حساب الإجمالي من الخادم…" className="justify-start p-0" />
        ) : null}
        {quoteIsError ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="text-[13px] text-danger">{errorMessage(quoteError)}</p>
            {quoteError instanceof ApiError && quoteError.code === 'PRICE_CHANGED' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRemoveServices}
              >
                إزالة الخدمات وإعادة اختيارها
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onRecalculateQuote}>
                إعادة حساب الإجمالي
              </Button>
            )}
          </div>
        ) : null}
        {quoteData ? (
          <dl className="space-y-1.5 rounded-control border border-line bg-surface/50 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">المجموع الفرعي</dt>
              <dd className="tabular">{quoteData.totals.subtotal} ج.م</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">الخصم</dt>
              <dd className="tabular">{quoteData.totals.discountAmount} ج.م</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">الضريبة</dt>
              <dd className="tabular">{quoteData.totals.taxAmount} ج.م</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
              <dt className="font-semibold">الإجمالي</dt>
              <dd className="tabular text-xl font-semibold">{quoteData.totals.total} ج.م</dd>
            </div>
          </dl>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {paymentMethods.map(({ method, label }) => (
            <div key={method} className="space-y-1.5">
              <Label htmlFor={`payment-${method}`}>{label}</Label>
              <Input
                id={`payment-${method}`}
                inputMode="decimal"
                className="text-start"
                value={payments[method]}
                onChange={(event) => onPaymentChange(method, event.target.value)}
              />
            </div>
          ))}
        </div>
        {remaining !== null ? (
          <p
            role="status"
            className={cn(
              'rounded-control border px-3 py-2 text-[13px] font-medium',
              remaining === BigInt(0)
                ? 'border-success/20 bg-success-soft text-success'
                : 'border-warning/20 bg-warning-soft text-warning',
            )}
          >
            {remaining === BigInt(0)
              ? 'تم سداد الإجمالي بالكامل'
              : remaining > BigInt(0)
                ? `المتبقي ${money(remaining)} ج.م`
                : `المدفوع زائد بمقدار ${money(-remaining)} ج.م`}
          </p>
        ) : null}
        {completionError && !ambiguous ? <p role="alert" className="text-[13px] text-danger">{errorMessage(completionError)}</p> : null}
        {storageError ? (
          <p role="alert" className="text-[13px] text-danger">
            تعذر حفظ طلب البيع بأمان. تأكد من إتاحة تخزين المتصفح ثم حاول مرة أخرى.
          </p>
        ) : null}
        <Button size="lg" className="w-full" disabled={!ready} onClick={onSubmit}>
          مراجعة وإتمام البيع + طباعة
        </Button>
      </CardContent>
    </Card>
  );
}

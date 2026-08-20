'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Building2, Clock3, UserRound } from 'lucide-react';

import { Badge, Button, Card, CardContent, EmptyState } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { PageHeader } from '@/components/layout/page-header';
import { ApiError } from '@/lib/api/client';
import { invoiceClientLabel } from '@/lib/client-label';

import { getCashierSessionDetail } from '../api/cashier-sessions-api';
import { cashierSessionQueryKeys } from '../query-keys';
import { ShiftMoney, formatShiftDuration, formatShiftMoney } from './shift-money';

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const statusLabels = {
  completed: 'مكتملة',
  partially_refunded: 'مستردة جزئيًا',
  refunded: 'مستردة',
  voided: 'ملغاة',
} as const;

const statusTones = {
  completed: 'success',
  partially_refunded: 'warning',
  refunded: 'warning',
  voided: 'danger',
} as const;

const errorMessage = (error: unknown) => (
  error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.'
);

/** One shift: what it moved, and every sale that money belongs to. */
export function ShiftDetailView({ sessionId }: { sessionId: number }) {
  const detail = useQuery({
    queryKey: cashierSessionQueryKeys.detail(sessionId),
    queryFn: () => getCashierSessionDetail(sessionId),
  });

  const summary = detail.data?.summary;

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="تفاصيل الوردية"
        description="حركة الوردية ومبيعاتها كما سُجلت وقت حدوثها."
      />

      {detail.isPending ? (
        <LoadingState label="جارٍ تحميل الوردية…" align="start" className="p-0" />
      ) : null}
      {detail.isError ? (
        <Notice tone="danger" role="alert">
          <p>{errorMessage(detail.error)}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void detail.refetch()}>
            إعادة المحاولة
          </Button>
        </Notice>
      ) : null}

      {summary ? (
        <Card className="shadow-card">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <dl className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-control border border-line bg-surface/60 px-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-[12px] text-muted">
                  <Building2 className="size-3.5 shrink-0" aria-hidden />
                  الفرع
                </dt>
                <dd className="mt-1 truncate text-sm font-medium text-ink">{summary.branchName}</dd>
              </div>
              <div className="rounded-control border border-line bg-surface/60 px-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-[12px] text-muted">
                  <UserRound className="size-3.5 shrink-0" aria-hidden />
                  فتحها
                </dt>
                <dd className="mt-1 truncate text-sm font-medium text-ink">
                  {summary.openedByUsername}
                </dd>
              </div>
              <div className="rounded-control border border-line bg-surface/60 px-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-[12px] text-muted">
                  <Clock3 className="size-3.5 shrink-0" aria-hidden />
                  المدة
                </dt>
                <dd className="mt-1 truncate text-sm font-medium text-ink">
                  <span className="tabular">{formatShiftDuration(summary.durationMinutes)}</span>
                  {' · '}
                  <time dateTime={summary.openedAt}>{formatCairoDateTime(summary.openedAt)}</time>
                </dd>
              </div>
            </dl>
            {summary.autoClosedAt ? (
              <Notice tone="warning">أنهى النظام هذه الوردية بعد ست عشرة ساعة من فتحها.</Notice>
            ) : null}
            <ShiftMoney summary={summary} />
          </CardContent>
        </Card>
      ) : null}

      {detail.data?.invoices.length === 0 ? (
        <Card className="shadow-card">
          <EmptyState
            title="لا توجد مبيعات في هذه الوردية"
            description="لم تُسجَّل أي فاتورة ولم يُصرف أي استرداد خلالها."
          />
        </Card>
      ) : null}

      <ul className="space-y-2">
        {detail.data?.invoices.map((invoice) => (
          <li key={invoice.id}>
            <Card className="shadow-card">
              <CardContent className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="font-mono font-semibold text-ink underline underline-offset-4"
                      href={`/invoices/${invoice.id}`}
                    >
                      {invoice.invoiceNumber}
                    </Link>
                    <Badge variant={statusTones[invoice.status]}>
                      {statusLabels[invoice.status]}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-ink">{invoiceClientLabel(invoice.client)}</p>
                  <time className="block text-[13px] text-muted" dateTime={invoice.soldAt}>
                    {formatCairoDateTime(invoice.soldAt)}
                  </time>
                </div>
                {/* What this shift took, which is not the invoice total once an
                    invoice can be paid across two shifts. */}
                <div className="text-sm sm:text-start">
                  <strong className="tabular block text-lg font-semibold text-ink">
                    {formatShiftMoney(invoice.takenInShift)}
                  </strong>
                  {invoice.refundedInShift === '0.00' ? null : (
                    <span className="tabular block text-danger">
                      −{formatShiftMoney(invoice.refundedInShift)}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

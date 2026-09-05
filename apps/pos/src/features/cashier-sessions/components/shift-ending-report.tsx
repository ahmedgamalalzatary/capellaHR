'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { PageHeader } from '@/components/layout/page-header';
import { ApiError } from '@/lib/api/client';
import { RECEIPT_PAGE_RULE } from '@/lib/print/hardware';
import { PrintPageRule } from '@/lib/print/page-rule';

import { getCashierSessionReport, type CashierSessionReport } from '../api/cashier-sessions-api';
import { cashierSessionQueryKeys } from '../query-keys';
import { formatShiftDuration } from './shift-money';

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const formatMoney = (value: string) => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value));

const errorMessage = (error: unknown) => (
  error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.'
);

const closureLabel = ({ summary }: CashierSessionReport) => {
  if (summary.autoClosedAt) return 'إغلاق تلقائي بواسطة النظام';
  if (summary.closedByAccountId === summary.openedByAccountId) return 'إغلاق بواسطة الكاشير';
  if (summary.closedByAccountId) return 'إغلاق استثنائي بواسطة المدير';
  return 'الوردية ما زالت مفتوحة';
};

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="min-w-0 break-words">{label}</dt>
      <dd dir="ltr" className="min-w-0 break-words text-left font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Separator() {
  return <div aria-hidden className="my-2 border-t border-dashed border-ink/70" />;
}

function ReportDocument({ report }: { report: CashierSessionReport }) {
  const { summary } = report;
  return (
    <article
      data-shift-report
      role="region"
      aria-label="تقرير نهاية الوردية"
      className="mx-auto w-full max-w-[76mm] bg-paper p-4 text-[13px] leading-6 text-ink print:px-[2mm] print:py-0"
    >
      <header className="mb-3 text-center">
        <h1 className="text-lg font-bold">تقرير الوردية</h1>
        <p className="font-semibold">الوردية رقم {summary.id}</p>
      </header>

      <dl>
        <ReportRow label="الكاشير" value={summary.openedByUsername} />
        <ReportRow label="الفرع" value={summary.branchName} />
        <ReportRow label="وقت الفتح" value={formatCairoDateTime(summary.openedAt)} />
        <ReportRow label="وقت الإغلاق" value={summary.closedAt ? formatCairoDateTime(summary.closedAt) : '—'} />
        <ReportRow label="مدة الوردية" value={formatShiftDuration(summary.durationMinutes)} />

        <Separator />
        <ReportRow label="إجمالي المبيعات قبل الخصم" value={formatMoney(report.sales.gross)} />
        <ReportRow label="المرتجعات" value={formatMoney(report.sales.returns)} />
        <ReportRow label="الإجمالي" value={formatMoney(report.sales.total)} />
        <ReportRow label="الخصم" value={formatMoney(report.sales.discount)} />
        <ReportRow label="الضريبة" value={formatMoney(report.sales.tax)} />
        <ReportRow label="الصافي" value={formatMoney(report.sales.net)} />

        <Separator />
        <ReportRow label="المصروفات" value={formatMoney(report.expenses)} />
        <ReportRow label="دفعات محصلة" value={formatMoney(report.collectedPayments)} />
        <ReportRow label="مبيعات آجل" value={formatMoney(report.creditSales)} />

        <Separator />
        <ReportRow label="نقدي" value={formatMoney(report.netByMethod.cash)} />
        <ReportRow label="فيزا" value={formatMoney(report.netByMethod.visa)} />
        <ReportRow label="إنستاباي" value={formatMoney(report.netByMethod.instapay)} />
        <ReportRow label="محفظة" value={formatMoney(report.netByMethod.vodafone_cash)} />

        <Separator />
        <ReportRow label="طريقة الإغلاق" value={closureLabel(report)} />
        {summary.closedByUsername ? <ReportRow label="إغلاق بواسطة" value={summary.closedByUsername} /> : null}
        <ReportRow label="وقت الإغلاق" value={summary.closedAt ? formatCairoDateTime(summary.closedAt) : '—'} />
      </dl>
    </article>
  );
}

function ShiftReportPrintSheet({ report, onPrinted }: { report: CashierSessionReport; onPrinted: () => void }) {
  useEffect(() => {
    document.body.classList.add('printing-report');
    const finish = () => {
      document.body.classList.remove('printing-report');
      onPrinted();
    };
    window.addEventListener('afterprint', finish, { once: true });
    window.print();
    return () => {
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-report');
    };
  }, [onPrinted]);

  return createPortal(
    <div id="print-root" className="p-0 text-ink">
      <PrintPageRule rule={RECEIPT_PAGE_RULE} />
      <ReportDocument report={report} />
    </div>,
    document.body,
  );
}

export function ShiftEndingReport({ sessionId }: { sessionId: number }) {
  const [printing, setPrinting] = useState(false);
  const report = useQuery({
    queryKey: cashierSessionQueryKeys.report(sessionId),
    queryFn: () => getCashierSessionReport(sessionId),
  });

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5">
      <div data-print-controls className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="تقرير نهاية الوردية" description="ملخص كامل لحركة الوردية وإجمالياتها." />
        {report.data ? (
          <Button onClick={() => setPrinting(true)}>
            <Printer className="size-4" aria-hidden />
            طباعة التقرير
          </Button>
        ) : null}
      </div>

      {report.isPending ? <LoadingState label="جارٍ تحميل تقرير الوردية…" align="start" className="p-0" /> : null}
      {report.isError ? (
        <Notice tone="danger" role="alert">
          <p>{errorMessage(report.error)}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void report.refetch()}>
            إعادة المحاولة
          </Button>
        </Notice>
      ) : null}

      {report.data ? <ReportDocument report={report.data} /> : null}
      {printing && report.data ? <ShiftReportPrintSheet report={report.data} onPrinted={() => setPrinting(false)} /> : null}
    </section>
  );
}

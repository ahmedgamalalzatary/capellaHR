'use client';

import type { PublicInvoiceDto } from '@capella/contracts';
import { CircleCheck, Printer, RotateCcw } from 'lucide-react';
import Link from 'next/link';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@capella/ui';

import { ReceiptBundle } from './receipt';

export function SaleCompletedCard({
  completed,
  branchId,
  printError,
  onPrint,
  onReset,
}: {
  completed: PublicInvoiceDto;
  branchId?: number;
  printError: string | null;
  onPrint: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <Card data-print-controls className="mx-auto max-w-lg shadow-raised">
        <CardHeader className="text-center"><CardTitle>تم حفظ الفاتورة</CardTitle></CardHeader>
        <CardContent className="space-y-5 p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <CircleCheck className="size-6" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="font-mono text-sm font-semibold text-muted">{completed.invoiceNumber}</p>
            <p className="tabular text-3xl font-semibold text-ink">{completed.totals.total} ج.م</p>
          </div>
          {printError ? <p role="alert" className="text-[13px] text-danger">{printError}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={onPrint}><Printer className="size-4" aria-hidden />طباعة الإيصال</Button>
            <Link className="inline-flex h-9 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-surface" href={`/invoices/${completed.id}${branchId ? `?branchId=${branchId}` : ''}`}>
              عرض الإيصال
            </Link>
            <Button variant="secondary" onClick={onReset}><RotateCcw className="size-4" aria-hidden />بيع جديد</Button>
          </div>
        </CardContent>
      </Card>

      {/* Only the receipt reaches the paper; the print stylesheet hides everything else. */}
      <div className="hidden print:block">
        <ReceiptBundle invoice={completed} />
      </div>
    </>
  );
}

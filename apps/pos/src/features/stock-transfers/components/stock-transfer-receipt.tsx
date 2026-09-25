'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { RECEIPT_PAGE_RULE } from '@/lib/print/hardware';
import { PrintPageRule } from '@/lib/print/page-rule';

import type { StockTransfer } from '../api/stock-transfers-api';

export function StockTransferReceipt({ transfer, onPrinted, onPrintError }: {
  transfer: StockTransfer;
  onPrinted: () => void;
  onPrintError: (message: string) => void;
}) {
  useEffect(() => {
    document.body.classList.add('printing-report');
    const finish = () => {
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-report');
      onPrinted();
    };
    window.addEventListener('afterprint', finish, { once: true });
    try {
      window.print();
    } catch {
      onPrintError('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح والطابعة ثم حاول مرة أخرى.');
      finish();
    }
    return () => {
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-report');
    };
  }, [onPrinted, onPrintError]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div id="print-root" className="p-0 text-ink">
      <article
        data-receipt
        className="mx-auto w-full max-w-[80mm] bg-paper text-sm font-semibold text-ink"
        style={{ boxSizing: 'border-box', padding: '8mm' }}
      >
        <PrintPageRule rule={RECEIPT_PAGE_RULE} />
        <header className="border-b border-dashed border-ink pb-3">
          <p className="font-serif text-2xl italic leading-none">Capella Care</p>
          <h1 className="mt-1.5 text-lg font-bold">إيصال تحويل</h1>
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-b border-dashed border-ink py-3 text-xs">
          <dt>رقم الفاتورة</dt><dd className="break-all font-mono text-[10px]">{transfer.invoiceNumber}</dd>
          <dt>التاريخ</dt><dd className="tabular">{transfer.transferDate}</dd>
          <dt>من فرع</dt><dd>{transfer.sourceBranchName}</dd>
          <dt>إلى فرع</dt><dd>{transfer.destinationBranchName}</dd>
          <dt>تاريخ الإنشاء</dt>
          <dd className="tabular"><time dateTime={transfer.createdAt}>{new Intl.DateTimeFormat('ar-EG', {
            timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
          }).format(new Date(transfer.createdAt))}</time></dd>
          <dt>الملاحظة</dt><dd>{transfer.note ?? '—'}</dd>
        </dl>
        <table className="mt-3 w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-surface">
              <th scope="col" className="border border-line px-1 py-1.5 text-start font-medium">المنتج</th>
              <th scope="col" className="border border-line px-1 py-1.5 font-medium">الكمية</th>
              <th scope="col" className="border border-line px-1 py-1.5 font-medium">الوحدة</th>
              <th scope="col" className="border border-line px-1 py-1.5 font-medium">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {transfer.lines.map((line) => (
              <tr key={`${line.sourceProductId}-${line.destinationProductId}`}>
                <td className="border border-line px-1 py-1.5 text-start">{line.productName}</td>
                <td className="border border-line px-1 py-1.5 text-center tabular">{line.quantity}</td>
                <td className="border border-line px-1 py-1.5 text-center tabular">{line.unitCost}</td>
                <td className="border border-line px-1 py-1.5 text-center tabular">{line.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-between border-y-2 border-ink py-1.5 font-bold">
          <span>التكلفة الإجمالية</span>
          <span className="tabular">{transfer.totalCost} ج.م</span>
        </div>
      </article>
    </div>,
    document.body,
  );
}

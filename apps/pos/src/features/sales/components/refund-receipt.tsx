'use client';

import type { PublicInvoiceDto } from '@capella/contracts';

import { formatCairoDateTime, paymentLabels } from './invoice-format';
import { ReceiptFooter } from './receipt';

type Reversal = PublicInvoiceDto['reversals'][number];

/**
 * The paper the client leaves with after a return. It is the sale receipt read
 * backwards: the same 80mm frame, the returned lines, and what went back on which
 * tender, so the two slips can be matched at the end of the shift.
 */
export function RefundReceipt({
  invoice,
  reversal,
}: {
  invoice: PublicInvoiceDto;
  reversal: Reversal;
}) {
  return (
    <article data-receipt className="mx-auto w-full max-w-[80mm] bg-paper p-4 text-sm text-ink">
      <header className="border-b border-dashed border-ink pb-3">
        <p className="font-serif text-2xl italic leading-none">Capella Care</p>
        <h1 className="mt-1.5 text-lg font-bold">كابيلا</h1>
        <p className="text-xs text-muted">
          {reversal.type === 'void' ? 'إيصال إلغاء' : 'إيصال استرداد'}
        </p>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-b border-dashed border-ink py-3">
        <dt>رقم الفاتورة</dt><dd className="font-mono text-xs">{invoice.invoiceNumber}</dd>
        <dt>التاريخ</dt>
        <dd><time dateTime={reversal.createdAt}>{formatCairoDateTime(reversal.createdAt)}</time></dd>
        <dt>العميل</dt><dd>{invoice.client.name}</dd>
        <dt>بواسطة</dt><dd>{reversal.actingAccount.username}</dd>
        <dt>السبب</dt><dd>{reversal.reason}</dd>
      </dl>
      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-surface">
            <th scope="col" className="border border-line px-1.5 py-1.5 text-start font-medium">الصنف المرتجع</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">الكمية</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {reversal.lines.map((line) => (
            <tr key={line.invoiceLineId}>
              <td className="border border-line px-1.5 py-1.5 text-start">{line.name}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.quantity}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-b border-dashed border-ink py-3 text-xs">
        <div data-grand-total className="flex items-baseline justify-between border-y-2 border-ink py-1.5 text-sm font-bold">
          <span>إجمالي المسترد</span>
          <span className="tabular">{reversal.totals.total} ج.م</span>
        </div>
      </div>
      <div className="border-b border-dashed border-ink py-3">
        <h2 className="text-sm font-semibold">رُد عبر</h2>
        <div className="mt-1.5 space-y-1.5 text-xs">
          {reversal.payments.length ? reversal.payments.map((payment) => (
            <div key={payment.method} className="flex justify-between">
              <span>{paymentLabels[payment.method]}</span>
              <span className="tabular">{payment.amount} ج.م</span>
            </div>
          )) : <p>لا توجد حركة دفع لهذا الاسترداد</p>}
        </div>
      </div>
      <ReceiptFooter />
    </article>
  );
}

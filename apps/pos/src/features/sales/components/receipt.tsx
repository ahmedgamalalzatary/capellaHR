'use client';

import type { PublicInvoiceDto } from '@capella/contracts';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { formatCairoDateTime, paymentLabels } from './invoice-format';

function ReceiptQr({ value }: { value: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 1, width: 144 })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      data-testid="receipt-qr"
      className="w-14 shrink-0 [&_svg]:h-auto [&_svg]:w-full"
      // qrcode emits a self-contained inline SVG built only from our own invoice number.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function Receipt({ invoice }: { invoice: PublicInvoiceDto }) {
  const totalQuantity = invoice.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <article data-receipt className="mx-auto w-full max-w-[80mm] bg-paper p-4 text-sm text-ink">
      <header className="flex items-start justify-between gap-3 border-b border-dashed border-ink pb-3">
        <div>
          <p className="font-serif text-2xl italic leading-none">Capella</p>
          <h1 className="mt-1.5 text-lg font-bold">كابيلا</h1>
          <p className="text-xs text-muted">إيصال بيع</p>
        </div>
        <ReceiptQr value={invoice.invoiceNumber} />
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-b border-dashed border-ink py-3">
        <dt>رقم الفاتورة</dt><dd className="font-mono text-xs" dir="ltr">{invoice.invoiceNumber}</dd>
        <dt>التاريخ</dt><dd><time dateTime={invoice.soldAt}>{formatCairoDateTime(invoice.soldAt)}</time></dd>
        <dt>العميل</dt><dd>{invoice.client.name}</dd>
        <dt>الهاتف</dt><dd dir="ltr" className="text-end">{invoice.client.phone}</dd>
        <dt>الموظف</dt><dd>{invoice.assignedEmployee?.name ?? 'بدون موظف'}</dd>
        {invoice.seller
          ? <dt>الكاشير</dt>
          : <dt>بواسطة</dt>}
        <dd>{invoice.seller?.name ?? invoice.authorizedBy.username}</dd>
      </dl>
      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-surface">
            <th scope="col" className="border border-line px-1.5 py-1.5 text-start font-medium">الصنف</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">السعر</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">الكمية</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td className="border border-line px-1.5 py-1.5 text-start">{line.name}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular" dir="ltr">{line.unitPrice}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular" dir="ltr">{line.quantity}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular" dir="ltr">{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-b border-dashed border-ink py-3 text-xs">
        <div className="flex justify-between text-muted">
          <span>عدد الأصناف</span>
          <span className="tabular" dir="ltr">{invoice.lines.length}</span>
        </div>
        <div className="flex justify-between text-muted">
          <span>إجمالي الكميات</span>
          <span className="tabular" dir="ltr">{totalQuantity}</span>
        </div>
        <div className="flex justify-between">
          <span>المجموع الفرعي</span>
          <span className="tabular" dir="ltr">{invoice.totals.subtotal} ج.م</span>
        </div>
        {invoice.discount ? (
          <div className="flex justify-between">
            <span>الخصم</span>
            <span className="tabular" dir="ltr">- {invoice.discount.amount} ج.م</span>
          </div>
        ) : null}
        {invoice.tax ? (
          <div className="flex justify-between">
            <span>الضريبة</span>
            <span className="tabular" dir="ltr">+ {invoice.tax.amount} ج.م</span>
          </div>
        ) : null}
        <div data-grand-total className="mt-1.5 flex items-baseline justify-between border-y-2 border-ink py-1.5 text-sm font-bold">
          <span>الإجمالي النهائي</span>
          <span className="tabular" dir="ltr">{invoice.totals.total} ج.م</span>
        </div>
      </div>
      <div className="border-b border-dashed border-ink py-3">
        <h2 className="text-sm font-semibold">المدفوعات</h2>
        <div className="mt-1.5 space-y-1.5 text-xs">
          {invoice.payments.map((payment) => (
            <div key={payment.method} className="flex justify-between">
              <span>{paymentLabels[payment.method]}</span>
              <span className="tabular" dir="ltr">{payment.amount} ج.م</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-dashed border-line pt-1.5 font-bold">
            <span>المدفوع</span>
            <span className="tabular" dir="ltr">{invoice.totals.paymentTotal} ج.م</span>
          </div>
        </div>
      </div>
      <footer className="pt-3 text-center">
        <p>شكرًا لزيارتكم</p>
        <p className="mt-1 text-xs text-muted">Capella · كابيلا</p>
      </footer>
    </article>
  );
}

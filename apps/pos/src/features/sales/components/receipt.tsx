'use client';

import type { PublicInvoiceDto } from '@capella/contracts';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { invoiceClientLabel } from '@/lib/client-label';
import { Barcode } from '@/lib/barcode/render-barcode';
import { RECEIPT_PAGE_RULE } from '@/lib/print/hardware';
import { PrintPageRule } from '@/lib/print/page-rule';

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

/**
 * The tail of the printed slip, matching the counter's existing paper: how to reach
 * the branch, and the return window the consumer-protection law obliges us to print.
 */
export function ReceiptFooter() {
  return (
    <footer className="pt-3 text-center">
      <p>شكرًا لزيارتكم</p>
      <p className="mt-1 text-xs">Tel : 01034660596 - 01034668590</p>
      <p className="text-xs">www.capellacares.com</p>
      <div className="mt-2 space-y-0.5 text-[11px] leading-snug text-muted">
        <p>سياسة الاستبدال والاسترجاع طبقًا لقانون حماية المستهلك</p>
        <p>1- خلال 14 يوم إذا كان المنتج بحالته الأصلية</p>
        <p>2- خلال 30 يوم إذا كان المنتج به عيب صناعة</p>
        <p>3- التواصل مع حماية المستهلك 19588</p>
      </div>
    </footer>
  );
}

type PublicInvoiceLine = PublicInvoiceDto['lines'][number];
type ReceiptEmployee = NonNullable<PublicInvoiceLine['employee']>;

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);
const TWO = BigInt(2);

const toCents = (value: string) => {
  const [whole = '0', fraction = '00'] = value.split('.');
  return BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, '0'));
};

const money = (value: bigint) => (
  `${value / HUNDRED}.${(value % HUNDRED).toString().padStart(2, '0')}`
);

/** The distinct employees who performed this invoice's services, in line order. */
export const invoiceEmployees = (invoice: PublicInvoiceDto): ReceiptEmployee[] => {
  const seen = new Map<number, ReceiptEmployee>();
  for (const line of invoice.lines) {
    if (line.employee && !seen.has(line.employee.id)) seen.set(line.employee.id, line.employee);
  }
  return [...seen.values()];
};

/**
 * One employee's share of the invoice. The discount and tax are split over the
 * employees in order by cumulative rounding, so the shares add up to the invoice
 * exactly, with no cent lost or invented.
 */
const employeeShare = (invoice: PublicInvoiceDto, employeeId: number) => {
  const employees = invoiceEmployees(invoice);
  const grossOf = (id: number) => invoice.lines
    .filter((line) => line.employee?.id === id)
    .reduce((sum, line) => sum + toCents(line.lineTotal), ZERO);
  const subtotal = toCents(invoice.totals.subtotal);
  const index = employees.findIndex((employee) => employee.id === employeeId);
  const prefix = employees.slice(0, index)
    .reduce((sum, employee) => sum + grossOf(employee.id), ZERO);
  const gross = grossOf(employeeId);
  const allocate = (amount: string) => {
    const total = toCents(amount);
    if (subtotal === ZERO) return ZERO;
    const upTo = (value: bigint) => (total * value * TWO + subtotal) / (subtotal * TWO);
    return upTo(prefix + gross) - upTo(prefix);
  };
  const discount = allocate(invoice.totals.discountAmount);
  const tax = allocate(invoice.totals.taxAmount);
  return {
    lines: invoice.lines.filter((line) => line.employee?.id === employeeId),
    subtotal: money(gross),
    discount: money(discount),
    tax: money(tax),
    total: money(gross - discount + tax),
  };
};

/**
 * The copy each employee keeps: their own services and their own share of the
 * invoice, printed on its own page beside the customer's receipt.
 */
export function EmployeeReceipt({
  invoice,
  employee,
}: {
  invoice: PublicInvoiceDto;
  employee: ReceiptEmployee;
}) {
  const share = employeeShare(invoice, employee.id);
  return (
    <article
      data-receipt
      data-employee-receipt
      className="mx-auto w-full max-w-[80mm] bg-paper p-4 text-sm text-ink"
    >
      <header className="border-b border-dashed border-ink pb-3">
        <p className="font-serif text-2xl italic leading-none">Capella Care</p>
        <h1 className="mt-1.5 text-lg font-bold">نسخة الموظف</h1>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-b border-dashed border-ink py-3">
        <dt>رقم الفاتورة</dt><dd className="font-mono text-xs">{invoice.invoiceNumber}</dd>
        <dt>التاريخ</dt>
        <dd><time dateTime={invoice.soldAt}>{formatCairoDateTime(invoice.soldAt)}</time></dd>
        <dt>الموظف</dt><dd>{employee.name}</dd>
        <dt>كود الموظف</dt><dd className="tabular">{employee.employeeCode}</dd>
      </dl>
      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-surface">
            <th scope="col" className="border border-line px-1.5 py-1.5 text-start font-medium">الصنف</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">عدد</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">سعر</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">قيمة</th>
          </tr>
        </thead>
        <tbody>
          {share.lines.map((line) => (
            <tr key={line.id}>
              <td className="border border-line px-1.5 py-1.5 text-start">{line.name}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.quantity}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.unitPrice}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-b border-dashed border-ink py-3 text-xs">
        <div className="flex justify-between">
          <span>المجموع الفرعي</span>
          <span className="tabular">{share.subtotal} ج.م</span>
        </div>
        {invoice.discount ? (
          <div className="flex justify-between">
            <span>الخصم</span>
            <span className="tabular">- {share.discount} ج.م</span>
          </div>
        ) : null}
        {invoice.tax ? (
          <div className="flex justify-between">
            <span>الضريبة</span>
            <span className="tabular">+ {share.tax} ج.م</span>
          </div>
        ) : null}
        <div className="mt-1.5 flex items-baseline justify-between border-y-2 border-ink py-1.5 text-sm font-bold">
          <span>إجمالي الموظف</span>
          <span className="tabular">{share.total} ج.م</span>
        </div>
      </div>
      <ReceiptFooter />
    </article>
  );
}

/**
 * What the counter prints for one sale: the customer's receipt, then one copy
 * for each employee who performed a service on it.
 */
export function ReceiptBundle({ invoice }: { invoice: PublicInvoiceDto }) {
  return (
    <div data-receipt-sheet className="space-y-4">
      <PrintPageRule rule={RECEIPT_PAGE_RULE} />
      <Receipt invoice={invoice} />
      {invoiceEmployees(invoice).map((employee) => (
        <EmployeeReceipt key={employee.id} invoice={invoice} employee={employee} />
      ))}
    </div>
  );
}

export function Receipt({ invoice }: { invoice: PublicInvoiceDto }) {
  const totalQuantity = invoice.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <article
      data-receipt
      data-customer-receipt
      className="mx-auto w-full max-w-[80mm] bg-paper p-4 text-sm text-ink"
    >
      <header className="flex items-start justify-between gap-3 border-b border-dashed border-ink pb-3">
        <div>
          <p className="font-serif text-2xl italic leading-none">Capella Care</p>
          <h1 className="mt-1.5 text-lg font-bold">كابيلا</h1>
          <p className="text-xs text-muted">إيصال بيع</p>
        </div>
        <ReceiptQr value={invoice.invoiceNumber} />
      </header>
      {/*
        * The QR carries the same invoice number but the QW2100 is a 1D scanner
        * and cannot read it, so the slip also carries a Code 128 the counter can
        * scan to pull the invoice up for a refund.
        */}
      <div className="flex justify-center border-b border-dashed border-ink py-2">
        <Barcode value={invoice.invoiceNumber} symbology="code128" heightMm={8} className="w-full [&_svg]:h-auto [&_svg]:w-full" />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-b border-dashed border-ink py-3">
        <dt>رقم الفاتورة</dt><dd className="font-mono text-xs">{invoice.invoiceNumber}</dd>
        <dt>التاريخ</dt><dd><time dateTime={invoice.soldAt}>{formatCairoDateTime(invoice.soldAt)}</time></dd>
        <dt>العميل</dt><dd>{invoiceClientLabel(invoice.client)}</dd>
        <dt>الهاتف</dt><dd className="text-start">{invoice.client.phone ?? '—'}</dd>
        <dt>الموظف</dt>
        <dd>{invoiceEmployees(invoice).map(({ name }) => name).join(' - ') || 'بدون موظف'}</dd>
        {invoice.seller
          ? <dt>الكاشير</dt>
          : <dt>بواسطة</dt>}
        <dd>{invoice.seller?.name ?? invoice.authorizedBy.username}</dd>
      </dl>
      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-surface">
            <th scope="col" className="border border-line px-1.5 py-1.5 text-start font-medium">الصنف</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">عدد</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">سعر</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">قيمة</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td className="border border-line px-1.5 py-1.5 text-start">{line.name}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.quantity}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.unitPrice}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular">{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-b border-dashed border-ink py-3 text-xs">
        <div className="flex justify-between text-muted">
          <span>عدد الأصناف</span>
          <span className="tabular">{invoice.lines.length}</span>
        </div>
        <div className="flex justify-between text-muted">
          <span>إجمالي الكميات</span>
          <span className="tabular">{totalQuantity}</span>
        </div>
        <div className="flex justify-between">
          <span>المجموع الفرعي</span>
          <span className="tabular">{invoice.totals.subtotal} ج.م</span>
        </div>
        {invoice.discount ? (
          <div className="flex justify-between">
            <span>الخصم</span>
            <span className="tabular">- {invoice.discount.amount} ج.م</span>
          </div>
        ) : null}
        {invoice.tax ? (
          <div className="flex justify-between">
            <span>الضريبة</span>
            <span className="tabular">+ {invoice.tax.amount} ج.م</span>
          </div>
        ) : null}
        <div data-grand-total className="mt-1.5 flex items-baseline justify-between border-y-2 border-ink py-1.5 text-sm font-bold">
          <span>الإجمالي النهائي</span>
          <span className="tabular">{invoice.totals.total} ج.م</span>
        </div>
      </div>
      <div className="border-b border-dashed border-ink py-3">
        <h2 className="text-sm font-semibold">المدفوعات</h2>
        <div className="mt-1.5 space-y-1.5 text-xs">
          {invoice.payments.map((payment) => (
            <div key={payment.method} className="flex justify-between">
              <span>{paymentLabels[payment.method]}</span>
              <span className="tabular">{payment.amount} ج.م</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-dashed border-line pt-1.5 font-bold">
            <span>المدفوع</span>
            <span className="tabular">{invoice.totals.paymentTotal} ج.م</span>
          </div>
        </div>
      </div>
      <ReceiptFooter />
    </article>
  );
}

import { type PublicInvoiceDto, saleFixtures } from '@capella/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  LABEL_PRINTER,
  RECEIPT_PAGE_RULE,
  RECEIPT_PRINTER,
  labelFitsRoll,
} from '../src/lib/print/hardware';
import { LABEL_SIZE_MM } from '../src/lib/barcode/label-size';
import { ReceiptBundle } from '../src/features/sales/components/receipt';
import { RefundReceipt } from '../src/features/sales/components/refund-receipt';

afterEach(cleanup);

/** The fixture is frozen `as const`; the components take a plain DTO. */
const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;

const [firstLine] = invoice.lines;
const line = firstLine!;

const refund = {
  id: 7,
  type: 'refund' as const,
  reason: 'عدم رضا العميل',
  actingAccount: { id: 1, username: 'admin' },
  approvingAccount: null,
  lines: [{
    invoiceLineId: line.id,
    lineNumber: 1,
    itemType: line.itemType,
    name: line.name,
    quantity: 1,
    grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
  }],
  payments: [{ method: 'cash' as const, amount: '185.00' }],
  totals: { grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
  createdAt: invoice.soldAt,
};

/** Every page rule the mounted document would apply to paper. */
const printRules = () => [...document.querySelectorAll('style')]
  .map((node) => node.textContent ?? '')
  .filter((rule) => rule.includes('@media print'));

describe('receipt paper', () => {
  it('sizes the printed page to the receipt printer roll instead of the driver default', () => {
    expect(RECEIPT_PRINTER.paperWidthMm).toBe(80);
    expect(RECEIPT_PAGE_RULE).toContain(`size: ${RECEIPT_PRINTER.paperWidthMm}mm auto`);
  });

  it('leaves edge margins to the printer driver', () => {
    expect(RECEIPT_PAGE_RULE).toContain('margin: 0;');
  });

  it('carries its own page rule so a sale never prints on the label roll shape', () => {
    render(<ReceiptBundle invoice={invoice} />);
    expect(printRules().some((rule) => rule.includes(RECEIPT_PAGE_RULE))).toBe(true);
  });

  it('sizes the refund note to the same roll as the sale it reverses', () => {
    render(<RefundReceipt invoice={invoice} reversal={refund} />);
    expect(printRules().some((rule) => rule.includes(RECEIPT_PAGE_RULE))).toBe(true);
  });
});

describe('label roll', () => {
  it('keeps the shipped sticker inside the label printer roll range', () => {
    expect(LABEL_PRINTER.paperWidthMm).toEqual({ min: 20, max: 60 });
    expect(labelFitsRoll(LABEL_SIZE_MM)).toBe(true);
  });

  it('rejects a sticker wider than the label printer can feed', () => {
    expect(labelFitsRoll({ width: 70, height: 30 })).toBe(false);
    expect(labelFitsRoll({ width: 10, height: 30 })).toBe(false);
  });
});

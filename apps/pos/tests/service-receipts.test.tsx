import { saleFixtures, type PublicInvoiceDto } from '@capella/contracts';
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { ReceiptBundle } from '../src/features/sales/components/receipt';

afterEach(cleanup);

const sara = { id: 8, employeeCode: 1008, name: 'Sara' };
const mona = { id: 9, employeeCode: 1009, name: 'Mona' };

const serviceInvoice = () => {
  const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
  invoice.lines = [2, 5].map((quantity, index) => ({
    ...invoice.lines[0]!, id: 81 + index, sourceId: 21 + index, name: `Service ${index + 1}`,
    quantity, unitPrice: '1.00', lineTotal: `${quantity}.00`, employee: sara,
    queueNumbers: Array.from({ length: quantity }, (_, unit) => unit + 1),
    queueAssignments: Array.from({ length: quantity }, (_, unit) => ({
      id: 100 + index * 10 + unit, queueNumber: unit + 1, employee: unit % 2 ? mona : sara,
    })),
  }));
  invoice.totals = { ...invoice.totals, subtotal: '7.00', discountAmount: '0.01',
    taxAmount: '0.02', total: '7.01' };
  invoice.discount = { kind: 'fixed', value: '0.01', amount: '0.01' };
  invoice.tax = { kind: 'fixed', value: '0.02', amount: '0.02' };
  return invoice;
};

it('prints seven service units with their current assigned employees plus the full customer invoice', () => {
  const invoice = serviceInvoice();
  const stored = structuredClone(invoice);
  const { container } = render(<ReceiptBundle invoice={invoice} />);
  expect(container.querySelectorAll('[data-customer-receipt]')).toHaveLength(1);
  const slips = [...container.querySelectorAll<HTMLElement>('[data-service-receipt]')];
  expect(slips).toHaveLength(7);
  expect(slips.map((slip) => within(slip).getAllByRole('cell').slice(1).map((cell) => cell.textContent)))
    .toEqual(Array.from({ length: 7 }, () => ['1', '1.00', '1.00']));
  expect(slips.map((slip) => slip.querySelector('dd[data-assigned-employee]')?.textContent))
    .toEqual(['Sara', 'Mona', 'Sara', 'Mona', 'Sara', 'Mona', 'Sara']);
  expect(slips.map((slip) => slip.querySelector('[data-grand-total] .tabular')?.textContent))
    .toEqual(['1.00 ج.م', '1.01 ج.م', '1.00 ج.م', '0.99 ج.م', '1.00 ج.م', '1.01 ج.م', '1.00 ج.م']);
  expect(invoice).toEqual(stored);
});

it('splits legacy service quantities without queue assignments and creates no extra product slips', () => {
  const invoice = serviceInvoice();
  invoice.lines[0]!.queueAssignments = [];
  invoice.lines[1] = { ...invoice.lines[1]!, itemType: 'product', queueNumbers: [], queueAssignments: [] };
  const { container } = render(<ReceiptBundle invoice={invoice} />);
  expect(container.querySelectorAll('[data-service-receipt]')).toHaveLength(2);
  expect(container.querySelectorAll('[data-receipt]')).toHaveLength(3);
});

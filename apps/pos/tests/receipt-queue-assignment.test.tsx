import { saleFixtures, type PublicInvoiceDto } from '@capella/contracts';
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { invoiceEmployees, Receipt } from '../src/features/sales/components/receipt';

it('shows each product employee beside their own product on the invoice receipt', () => {
  const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
  invoice.lines = [
    { ...invoice.lines[0]!, id: 201, itemType: 'product', name: 'Shampoo',
      employee: { id: 8, employeeCode: 1008, name: 'Sara' },
      queueNumbers: [], queueAssignments: [] },
    { ...invoice.lines[0]!, id: 202, itemType: 'product', name: 'Conditioner',
      employee: { id: 9, employeeCode: 1009, name: 'Mona' },
      queueNumbers: [], queueAssignments: [] },
  ];
  render(<Receipt invoice={invoice} />);
  expect(within(screen.getByText('Shampoo').closest('tr')!).queryByText('Sara')).not.toBeNull();
  expect(within(screen.getByText('Conditioner').closest('tr')!).queryByText('Mona')).not.toBeNull();
});

it('prints a separate employee copy for each distinct queue performer', () => {
  const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
  invoice.lines[0] = {
    ...invoice.lines[0]!, quantity: 2, lineTotal: '400.00', commissionAmount: '60.00',
    queueNumbers: [1, 2],
    queueAssignments: [
      { id: 101, queueNumber: 1, employee: { id: 8, employeeCode: 1008, name: 'Sara' } },
      { id: 102, queueNumber: 2, employee: { id: 9, employeeCode: 1009, name: 'Mona' } },
    ],
  };
  invoice.totals.subtotal = '400.00';
  invoice.totals.total = '400.00';

  expect(invoiceEmployees(invoice).map((employee) => employee.id)).toEqual([8, 9]);
});

it('prints each queue number beside its assigned employee on the customer receipt', () => {
  const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
  invoice.lines[0] = {
    ...invoice.lines[0]!, quantity: 2, lineTotal: '400.00',
    queueNumbers: [1, 2],
    queueAssignments: [
      { id: 101, queueNumber: 1, employee: { id: 8, employeeCode: 1008, name: 'Sara' } },
      { id: 102, queueNumber: 2, employee: { id: 9, employeeCode: 1009, name: 'Mona' } },
    ],
  };
  render(<Receipt invoice={invoice} />);
  expect(screen.queryByText('1 · Sara')).not.toBeNull();
  expect(screen.queryByText('2 · Mona')).not.toBeNull();
});

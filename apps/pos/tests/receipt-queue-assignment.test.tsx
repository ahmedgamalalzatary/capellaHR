import { saleFixtures, type PublicInvoiceDto } from '@capella/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { invoiceEmployees, Receipt } from '../src/features/sales/components/receipt';

it('shows each product employee beside their own product on the invoice receipt', () => {
  const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
  invoice.lines = [
    { ...invoice.lines[0]!, id: 201, itemType: 'product', sourceId: 31, name: 'Shampoo',
      employee: { id: 8, employeeCode: 1008, name: 'Sara' },
      queueNumbers: [], queueAssignments: [] },
    { ...invoice.lines[0]!, id: 202, itemType: 'product', sourceId: 32, name: 'Conditioner',
      employee: { id: 9, employeeCode: 1009, name: 'Mona' },
      queueNumbers: [], queueAssignments: [] },
  ];
  render(<Receipt invoice={invoice} />);
  expect(within(screen.getByText('Shampoo').closest('tr')!).queryByText('Sara × 1')).not.toBeNull();
  expect(within(screen.getByText('Conditioner').closest('tr')!).queryByText('Mona × 1')).not.toBeNull();
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

it('names up-front booking money on the receipt instead of a till method', () => {
  const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
  invoice.payments = [
    { ...invoice.payments[0]!, method: 'booking_credit', amount: '100.00' },
    { ...invoice.payments[0]!, method: 'cash', amount: '85.00' },
  ];
  render(<Receipt invoice={invoice} />);
  expect(screen.getAllByText('مدفوع من المقدم').length).toBeGreaterThan(0);
  expect(screen.queryByText('booking_credit')).toBeNull();
});

afterEach(cleanup);

const sara = { id: 8, employeeCode: 1008, name: 'Sara' };
const mona = { id: 9, employeeCode: 1009, name: 'Mona' };
const invoice = () => structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
const itemRows = () => within(screen.getAllByRole('table')[0]!).getAllByRole('row').slice(1);

it('combines product units and shows each employee quantity without changing stored lines', () => {
  const sale = invoice();
  sale.lines = [sara, mona, mona].map((employee, index) => ({
    ...sale.lines[0]!, id: 201 + index, lineNumber: index + 1,
    itemType: 'product', sourceId: 31, name: 'Shampoo', employee,
    originalEmployee: employee, unitPrice: '50.10', lineTotal: '50.10',
    queueNumbers: [], queueAssignments: [],
    batches: [{ batchId: index < 2 ? 1 : 2, quantity: '1.000', expiryDate: '2027-01-01' }],
  }));
  const stored = structuredClone(sale);

  render(<Receipt invoice={sale} />);

  expect(itemRows()).toHaveLength(1);
  const cells = within(itemRows()[0]!).getAllByRole('cell');
  expect(cells.slice(1).map((cell) => cell.textContent)).toEqual(['3', '50.10', '150.30']);
  expect(cells[0]!.textContent).toContain('Sara × 1 - Mona × 2');
  expect(cells[0]!.textContent).toContain('دفعة #1 × 2');
  expect(cells[0]!.textContent).toContain('دفعة #2 × 1');
  expect(screen.getByText('عدد الأصناف').nextElementSibling?.textContent).toBe('1');
  expect(screen.getByText('إجمالي الكميات').nextElementSibling?.textContent).toBe('3');
  expect(sale).toEqual(stored);
});

it('combines services using the current queue performers and keeps all queue details', () => {
  const sale = invoice();
  sale.lines = [
    { ...sale.lines[0]!, employee: sara, originalEmployee: sara,
      queueNumbers: [1], queueAssignments: [{ id: 101, queueNumber: 1, employee: sara }] },
    { ...sale.lines[0]!, id: 202, quantity: 2, lineTotal: '400.00', employee: sara,
      originalEmployee: sara, queueNumbers: [2, 3], queueAssignments: [
        { id: 102, queueNumber: 2, employee: mona },
        { id: 103, queueNumber: 3, employee: mona },
      ] },
  ];

  render(<Receipt invoice={sale} />);

  expect(itemRows()).toHaveLength(1);
  const cells = within(itemRows()[0]!).getAllByRole('cell');
  expect(cells.slice(1).map((cell) => cell.textContent)).toEqual(['3', '200.00', '600.00']);
  expect(cells[0]!.textContent).toContain('Sara × 1 - Mona × 2');
  expect(cells[0]!.textContent).toContain('أرقام الدور: 1، 2، 3');
  expect(cells[0]!.textContent).toContain('2 · Mona');
});

it('keeps different item identities and types separate while listing all prices for one item', () => {
  const sale = invoice();
  const product = { ...sale.lines[0]!, itemType: 'product' as const, sourceId: 31,
    name: 'Shampoo', employee: sara, queueNumbers: [], queueAssignments: [] };
  sale.lines = [
    product,
    { ...product, id: 202, sourceId: 32 },
    { ...product, id: 203, unitPrice: '100.00', lineTotal: '100.00' },
    { ...sale.lines[0]!, id: 204, sourceId: 31 },
  ];

  render(<Receipt invoice={sale} />);

  expect(itemRows()).toHaveLength(3);
  expect(itemRows().map((row) => within(row).getAllByRole('cell')[2]!.textContent))
    .toEqual(['100.00 / 200.00', '200.00', '200.00']);
  expect(within(itemRows()[0]!).getAllByRole('cell').slice(1).map((cell) => cell.textContent))
    .toEqual(['2', '100.00 / 200.00', '300.00']);
});

it('groups legacy unassigned product quantities without inventing an employee', () => {
  const sale = invoice();
  const product = { ...sale.lines[0]!, itemType: 'product' as const, employee: null,
    originalEmployee: null, quantity: 2, lineTotal: '400.00', queueNumbers: [] };
  sale.lines = [product, { ...product, id: 202 }];

  render(<Receipt invoice={sale} />);

  expect(itemRows()).toHaveLength(1);
  expect(within(itemRows()[0]!).getAllByRole('cell').slice(1).map((cell) => cell.textContent))
    .toEqual(['4', '200.00', '800.00']);
  expect(screen.getByText('بدون موظف')).toBeDefined();
});

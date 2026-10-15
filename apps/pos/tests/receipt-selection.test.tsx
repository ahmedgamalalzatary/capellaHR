import { saleFixtures, type PublicInvoiceDto } from '@capella/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { SaleCompletedCard } from '../src/features/sales/components/sale-completed-card';

afterEach(cleanup);

it('lets the cashier print any subset of service units and the full invoice without changing the saved sale', async () => {
  const invoice = structuredClone(saleFixtures.completedInvoice) as unknown as PublicInvoiceDto;
  invoice.lines[0] = { ...invoice.lines[0]!, quantity: 7, lineTotal: '1400.00',
    queueNumbers: [1, 2, 3, 4, 5, 6, 7], queueAssignments: [] };
  const stored = structuredClone(invoice);
  let printed: Element | null = null;
  const onPrint = vi.fn(() => { printed = document.querySelector('[data-receipt-sheet]')?.cloneNode(true) as Element; });
  render(<SaleCompletedCard completed={invoice} printError={null} onPrint={onPrint} onReset={() => undefined} />);
  const choices = screen.getAllByRole('checkbox');
  expect(choices).toHaveLength(8);
  expect(choices.every((choice) => (choice as HTMLInputElement).checked)).toBe(true);
  expect(onPrint).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'إلغاء تحديد الكل' }));
  expect(screen.getByRole('button', { name: /طباعة المحدد/ })).toHaveProperty('disabled', true);
  fireEvent.click(choices[2]!);
  fireEvent.click(choices[5]!);
  fireEvent.click(screen.getByRole('button', { name: 'طباعة المحدد (2)' }));
  await waitFor(() => expect(onPrint).toHaveBeenCalledOnce());
  const paper = printed as Element | null;
  expect(paper?.querySelectorAll('[data-receipt]')).toHaveLength(2);
  expect(paper?.querySelectorAll('[data-testid="receipt-qr"] svg')).toHaveLength(2);
  expect(paper?.querySelector('[data-customer-receipt]')).toBeNull();
  expect([...paper!.querySelectorAll<HTMLElement>('[data-service-receipt]')].map((node) =>
    [...node.querySelectorAll('span')].find((span) => span.textContent?.startsWith('أرقام الدور:'))?.textContent))
    .toEqual(['أرقام الدور: 2', 'أرقام الدور: 5']);
  expect(invoice).toEqual(stored);
  expect(document.querySelector('[data-receipt-sheet]')).toBeNull();
});

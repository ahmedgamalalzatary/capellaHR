import { expect, test, type Route } from '@playwright/test';

import { saleFixtures } from '@capella/contracts';
import { e2eBaseUrl } from '../../playwright-port';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};

const json = (route: Route, data: unknown) => route.fulfill({
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify({ data }),
});

test('Cashier searches invoices, partially refunds one, and fully voids another', async ({ page }) => {
  const baseInvoice = structuredClone(saleFixtures.completedInvoice);
  const refundInvoice = {
    ...baseInvoice,
    lines: baseInvoice.lines.map((line) => ({
      ...line,
      quantity: 2,
      unitPrice: '100.00',
      lineTotal: '200.00',
      refundedQuantity: 0,
      refundableQuantity: 2,
    })),
    payments: baseInvoice.payments.map((payment) => ({
      ...payment, refundedAmount: '0.00', refundableAmount: payment.amount,
    })),
    reversals: [],
    eligibility: { canVoid: false, canRefund: true },
  };
  const voidInvoice = {
    ...refundInvoice,
    id: 45,
    invoiceNumber: 'INV-2026.08.03-14.36-18',
    eligibility: { canVoid: true, canRefund: true },
  };
  let search: string | null = null;
  let refundRequest: Record<string, unknown> | null = null;
  let voidRequest: Record<string, unknown> | null = null;
  let refunded = false;
  let voided = false;
  const refundedProjection = () => ({
    ...refundInvoice,
    status: 'partially_refunded',
    eligibility: { canVoid: false, canRefund: true },
    lines: refundInvoice.lines.map((line) => ({
      ...line, refundedQuantity: 1, refundableQuantity: 1,
    })),
    // The money went back on the card, not on the cash the client paid, so the
    // original payment keeps its full refundable rest.
    payments: refundInvoice.payments.map((payment) => ({
      ...payment, refundedAmount: '0.00', refundableAmount: payment.amount,
    })),
    reversals: [{
      id: 71,
      type: 'refund',
      reason: 'عدم رضا العميل',
      actingAccount: { id: 8, username: 'cashier.one' },
      approvingAccount: null,
      totals: {
        grossAmount: '100.00', discountAmount: '10.00', taxAmount: '2.50', total: '92.50',
      },
      lines: [{
        invoiceLineId: refundInvoice.lines[0]!.id,
        lineNumber: refundInvoice.lines[0]!.lineNumber,
        itemType: refundInvoice.lines[0]!.itemType,
        name: refundInvoice.lines[0]!.name,
        quantity: 1,
        grossAmount: '100.00', discountAmount: '10.00', taxAmount: '2.50', total: '92.50',
      }],
      payments: [{ method: 'visa', amount: '92.50' }],
      createdAt: '2026-08-04T09:00:00.000Z',
    }],
  });
  const voidedProjection = () => ({
    ...voidInvoice,
    status: 'voided',
    eligibility: { canVoid: false, canRefund: false },
    reversals: [{
      id: 72,
      type: 'void',
      reason: 'فاتورة مكررة',
      actingAccount: { id: 8, username: 'cashier.one' },
      approvingAccount: null,
      totals: {
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      },
      lines: [{
        invoiceLineId: voidInvoice.lines[0]!.id,
        lineNumber: voidInvoice.lines[0]!.lineNumber,
        itemType: voidInvoice.lines[0]!.itemType,
        name: voidInvoice.lines[0]!.name,
        quantity: 2,
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      }],
      payments: [{ method: 'cash', amount: '185.00' }],
      createdAt: '2026-08-03T20:00:00.000Z',
    }],
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (path === '/auth/session') {
      await json(route, { actor: { type: 'cashier', accountId: 8 } });
      return;
    }
    if (path === '/erp/cashier-sessions/current') {
      await json(route, null);
      return;
    }
    if (path === '/erp/sales' && request.method() === 'GET') {
      search = url.searchParams.get('search');
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [refundInvoice, voidInvoice].map((invoice) => ({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            total: invoice.totals.total,
            client: { id: invoice.client.id, name: invoice.client.name },
            employees: invoice.lines[0]!.employee
              ? [{ id: invoice.lines[0]!.employee.id, name: invoice.lines[0]!.employee.name }]
              : [],
            soldAt: invoice.soldAt,
          })),
          meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        }),
      });
      return;
    }
    if (path === `/erp/sales/${refundInvoice.id}` && request.method() === 'GET') {
      await json(route, refunded ? refundedProjection() : refundInvoice);
      return;
    }
    if (path === `/erp/sales/${voidInvoice.id}` && request.method() === 'GET') {
      await json(route, voided ? voidedProjection() : voidInvoice);
      return;
    }
    if (path === `/erp/sales/${refundInvoice.id}/refunds/quote`) {
      await json(route, {
        lines: [{
          invoiceLineId: refundInvoice.lines[0]!.id,
          quantity: 1,
          grossAmount: '100.00',
          discountAmount: '10.00',
          taxAmount: '2.50',
          total: '92.50',
        }],
        totals: {
          grossAmount: '100.00', discountAmount: '10.00', taxAmount: '2.50', total: '92.50',
        },
        payments: [
          { method: 'cash', paidAmount: '185.00', refundableAmount: '185.00' },
          { method: 'visa', paidAmount: '0.00', refundableAmount: '0.00' },
          { method: 'instapay', paidAmount: '0.00', refundableAmount: '0.00' },
          { method: 'vodafone_cash', paidAmount: '0.00', refundableAmount: '0.00' },
        ],
      });
      return;
    }
    if (path === `/erp/sales/${refundInvoice.id}/refunds` && request.method() === 'POST') {
      refundRequest = request.postDataJSON() as Record<string, unknown>;
      refunded = true;
      await json(route, refundedProjection());
      return;
    }
    if (path === `/erp/sales/${voidInvoice.id}/void` && request.method() === 'POST') {
      voidRequest = request.postDataJSON() as Record<string, unknown>;
      voided = true;
      await json(route, voidedProjection());
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/refunds');
  await page.getByLabel('بحث برقم الفاتورة أو العميل').fill(`  ${refundInvoice.client.name}  `);
  await page.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect.poll(() => search).toBe(refundInvoice.client.name);
  await page.getByRole('button', { name: `فتح مرتجع ${refundInvoice.invoiceNumber}` }).click();

  await page.getByRole('button', { name: 'استرداد', exact: true }).click();
  await page.getByLabel(`كمية استرداد ${refundInvoice.lines[0]!.name}`).fill('1');
  await page.getByRole('button', { name: 'احسب الاسترداد' }).click();
  await page.getByLabel('سبب الاسترداد').fill('عدم رضا العميل');
  // The sale was paid in cash but the client wants it back on the card, so the
  // prefilled split is moved across before confirming.
  await page.getByLabel('مبلغ الاسترداد نقدي').fill('0');
  await expect(page.getByText('متبقٍ للتوزيع 92.50 ج.م')).toBeVisible();
  await page.getByLabel('مبلغ الاسترداد فيزا').fill('92.50');
  await page.getByRole('button', { name: 'تأكيد الاسترداد' }).click();
  await expect(page.getByRole('heading', { name: 'سجل الإلغاء والاسترداد' })).toBeVisible();
  // Scoped to the history: the reason also appears on the print-only refund note.
  await expect(page.locator('details').getByText('عدم رضا العميل')).toBeVisible();
  await expect(page.getByText(`${refundInvoice.lines[0]!.name} × 1 · 92.50 ج.م`)).toBeVisible();
  expect(refundRequest).toMatchObject({
    reason: 'عدم رضا العميل',
    lines: [{ invoiceLineId: refundInvoice.lines[0]!.id, quantity: 1 }],
    payments: [{ method: 'visa', amount: '92.50' }],
    idempotencyKey: expect.any(String),
  });

  await page.goto(`/invoices/${voidInvoice.id}`);
  await page.getByRole('button', { name: 'إلغاء الفاتورة' }).click();
  await page.getByLabel('سبب الإلغاء').fill('فاتورة مكررة');
  await page.getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect(page.getByText('فاتورة مكررة')).toBeVisible();
  expect(voidRequest).toMatchObject({
    reason: 'فاتورة مكررة',
    idempotencyKey: expect.any(String),
  });
});

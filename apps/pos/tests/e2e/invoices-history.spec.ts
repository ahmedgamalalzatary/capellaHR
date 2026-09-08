import { saleFixtures } from '@capella/contracts';
import { expect, test } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};

test('invoice history searches live and opens the whole row', async ({ page }) => {
  const invoice = saleFixtures.completedInvoice;
  let search: string | undefined;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const fulfill = (data: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ data }),
    });
    if (path === '/auth/session') {
      await fulfill({ actor: { type: 'cashier', accountId: 8 } });
      return;
    }
    if (path === '/erp/cashier-sessions/current') {
      await fulfill({
        id: 14, branchId: 3, branchName: 'الفرع الرئيسي',
        openedByAccountId: 8, openedByUsername: 'cashier.one',
        openedAt: '2026-08-04T09:30:00.000Z',
      });
      return;
    }
    if (path === '/erp/sales' && request.method() === 'GET') {
      search = new URL(request.url()).searchParams.get('search') ?? undefined;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            total: invoice.totals.total,
            amountPaid: invoice.totals.amountPaid,
            balanceDue: invoice.totals.balanceDue,
            settlementStatus: invoice.totals.settlementStatus,
            client: { id: invoice.client.id, name: invoice.client.name },
            employees: invoice.lines[0]?.employee
              ? [{ id: invoice.lines[0].employee.id, name: invoice.lines[0].employee.name }]
              : [],
            soldAt: invoice.soldAt,
          }],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      });
      return;
    }
    if (path === `/erp/sales/${invoice.id}`) {
      await fulfill(invoice);
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/invoices');
  await expect(page.getByRole('link', { name: invoice.invoiceNumber })).toBeVisible();
  await page.getByLabel('بحث برقم الفاتورة أو العميل').fill(`  ${invoice.client.name}  `);
  await expect.poll(() => search).toBe(invoice.client.name);
  await expect(page.getByRole('button', { name: 'بحث' })).toHaveCount(0);
  await page.getByRole('link', { name: invoice.invoiceNumber }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}`));
  await expect(page.getByRole('button', { name: 'طباعة الإيصال' })).toBeVisible();
});

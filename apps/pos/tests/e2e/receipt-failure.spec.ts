import { saleFixtures } from '@capella/contracts';
import { expect, test } from '@playwright/test';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': `http://localhost:${process.env.POS_E2E_PORT ?? 3001}`,
};

test('receipt loading exposes a safe request reference and recovers without a sale write', async ({ page }) => {
  let detailReads = 0;
  let saleWrites = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (path === '/auth/session') {
      await route.fulfill({
        contentType: 'application/json', headers: corsHeaders,
        body: JSON.stringify({ data: { actor: { type: 'cashier', accountId: 3, employeeId: 9 } } }),
      });
      return;
    }
    if (path === '/erp/cashier-sessions/current') {
      await route.fulfill({ contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ data: null }) });
      return;
    }
    if (path === '/erp/sales/44') {
      detailReads += 1;
      if (detailReads === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: {
            code: 'INTERNAL_ERROR', message: 'تعذر تحميل الفاتورة', requestId: 'receipt-browser-7',
          } }),
        });
      } else {
        await route.fulfill({
          contentType: 'application/json', headers: corsHeaders,
          body: JSON.stringify({ data: saleFixtures.completedInvoice }),
        });
      }
      return;
    }
    if (path === '/erp/sales' && request.method() === 'POST') saleWrites += 1;
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/invoices/44');
  await expect(page.getByRole('alert').filter({ hasText: 'receipt-browser-7' })).toBeVisible();
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  await expect(page.getByText(saleFixtures.completedInvoice.invoiceNumber)).toBeVisible();
  expect(detailReads).toBe(2);
  expect(saleWrites).toBe(0);
});

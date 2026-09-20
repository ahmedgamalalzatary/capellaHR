import { expect, test } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};

test('keeps every page-level branch selector narrow enough for RTL native menus', async ({ page }) => {
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
    const fulfillPage = (items: unknown[]) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({
        data: items,
        meta: { page: 1, pageSize: 100, total: items.length, totalPages: 1 },
      }),
    });
    if (path === '/auth/session') {
      await fulfill({ actor: { type: 'admin', accountId: 1 } });
      return;
    }
    if (path === '/branches') {
      await fulfillPage([{ id: 3, name: 'الفرع الرئيسي' }]);
      return;
    }
    if (path === '/erp/bookings') {
      await fulfill([]);
      return;
    }
    if (path === '/erp/bookings/employee-options') {
      await fulfill([]);
      return;
    }
    if (path === '/erp/consumables' || path === '/erp/consumables/services') {
      await fulfillPage([]);
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  const pageSelectors = [
    ['/sales', '#sale-branch'],
    ['/bookings', 'select[aria-label="الفرع"]'],
    ['/invoices', '#invoice-branch'],
    ['/refunds', '#refund-invoice-branch'],
    ['/clients', '#clients-branch'],
    ['/consumables', '#consumables-branch'],
    ['/cashier-sessions', '#cashier-session-branch'],
    ['/catalog', '#catalog-branch'],
    ['/products', '#product-branch'],
    ['/suppliers', '#supplier-branch'],
    ['/expenses', '#expense-branch'],
    ['/fixed-assets', '#asset-branch'],
    ['/commissions', '#commissions-branch'],
    ['/reports', '#report-branch'],
  ] as const;

  for (const [path, selector] of pageSelectors) {
    await page.goto(path);
    const branchSelect = page.locator(selector);
    await expect(branchSelect, `${path} branch selector`).toBeVisible();
    expect((await branchSelect.boundingBox())!.width, `${path} branch selector width`)
      .toBeLessThanOrEqual(384);
  }
});

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

  // [path, selector, max width]. 384px is the `max-w-sm` used by a normal
  // page-level filter. Commissions lays its filters out as full-width grid
  // cells, so it is allowed the wider cell but still bounded.
  const pageSelectors: Array<readonly [string, string, number]> = [
    ['/sales', '#sale-branch', 384],
    ['/bookings', 'select[aria-label="الفرع"]', 384],
    ['/invoices', '#invoice-branch', 384],
    ['/refunds', '#refund-invoice-branch', 384],
    ['/clients', '#clients-branch', 384],
    ['/consumables', '#consumables-branch', 384],
    ['/cashier-sessions', '#cashier-session-branch', 384],
    ['/catalog', '#catalog-branch', 384],
    ['/products', '#product-branch', 384],
    ['/suppliers', '#supplier-branch', 384],
    ['/expenses', '#expense-branch', 384],
    ['/fixed-assets', '#asset-branch', 384],
    ['/commissions', '#commissions-branch', 480],
    ['/reports', '#report-branch', 384],
  ];

  for (const [path, selector, maxWidth] of pageSelectors) {
    await page.goto(path);
    const branchSelect = page.locator(selector);
    await expect(branchSelect, `${path} branch selector`).toBeVisible();
    expect((await branchSelect.boundingBox())!.width, `${path} branch selector width`)
      .toBeLessThanOrEqual(maxWidth);
  }
});

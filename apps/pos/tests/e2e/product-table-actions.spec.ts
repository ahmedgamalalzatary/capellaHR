import { expect, test, type Route } from '@playwright/test';
import { e2eBaseUrl } from '../../playwright-port';

/**
 * The products ledger carries seven columns and five row actions, which is more
 * than a till screen can show at once. The actions used to be the casualty: the
 * table held every column at its full content width, overflowed its card to the
 * left, and the scrollbar that would have revealed the last button sat below the
 * final row — so on a real catalogue it could not be reached at all. This guards
 * both halves of the fix, at the desk and at the till, since only the wide
 * viewport can fit the table without scrolling.
 */
const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};
const json = (route: Route, data: unknown, meta?: unknown) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify(meta ? { data, meta } : { data }),
});

/** Names off the shop's own shelves: long enough to push the table past its card. */
const products = [
  'oil hair mask 500 gm 15',
  'aromatic massage oil herbs & lavander oil ml 100',
  'aromatic massage oil orange & lemon ml 100',
].map((name, index) => ({
  id: index + 1,
  branchId: 3,
  name,
  description: null,
  sellingPrice: '250.00',
  lastPurchaseCost: '200.00',
  commissionPercent: '0.00',
  lowStockThreshold: 5,
  barcode: index === 0 ? '2000000000114' : null,
  isActive: true,
  quantity: 0,
  createdAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
}));

test('keeps every row action inside the products table', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: corsHeaders }); return; }
    if (path === '/auth/session') { await json(route, { actor: { type: 'admin' } }); return; }
    if (path === '/branches') {
      await json(route, [{ id: 3, name: 'الفرع الرئيسي' }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
      return;
    }
    if (path === '/erp/products' && request.method() === 'GET') {
      await json(route, products, { page: 1, pageSize: 100, total: products.length, totalPages: 1 });
      return;
    }
    if (path === '/erp/products/movements') {
      await json(route, [], { page: 1, pageSize: 20, total: 0, totalPages: 0 });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/products');
  await page.getByLabel('الفرع').selectOption('3');
  await expect(page.getByRole('cell', { name: /oil hair mask/ })).toBeVisible();

  const table = page.getByRole('table').first();
  const scroller = page.locator('.overflow-x-auto').filter({ has: table }).first();
  const viewport = (await scroller.boundingBox())!;

  // The toggle closes the row, so it is the button the overflow used to swallow.
  const toggles = page.getByRole('button', { name: 'إيقاف' });
  await expect(toggles).toHaveCount(products.length);

  for (let index = 0; index < products.length; index += 1) {
    const button = (await toggles.nth(index).boundingBox())!;
    expect(button.x, `row ${index} starts inside the table`).toBeGreaterThanOrEqual(viewport.x - 0.5);
    expect(
      button.x + button.width,
      `row ${index} ends inside the table`,
    ).toBeLessThanOrEqual(viewport.x + viewport.width + 0.5);
  }
});

import { expect, test, type Route } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};
const json = (route: Route, data: unknown, meta?: unknown) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify(meta ? { data, meta } : { data }),
});

test('prints label text without clipping or overlapping adjacent rows', async ({ page }, testInfo) => {
  await page.addInitScript(() => { window.print = () => undefined; });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (path === '/auth/session') { await json(route, { actor: { type: 'admin' } }); return; }
    if (path === '/branches') {
      await json(route, [{ id: 3, name: 'الفرع الرئيسي' }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
      return;
    }
    if (path === '/erp/products') {
      await json(route, [{
        id: 58, branchId: 3, name: 'oil hair mask 500 gm 15',
        description: null, sellingPrice: '500.00', lastPurchaseCost: '200.00',
        commissionPercent: '0.00', lowStockThreshold: 5, barcode: '2000000000589',
        isActive: true, quantity: 10,
        createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
      }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
      return;
    }
    if (path === '/erp/products/movements') {
      await json(route, [], { page: 1, pageSize: 20, total: 0, totalPages: 0 });
      return;
    }
    await route.fulfill({ status: 404, headers: corsHeaders, body: '{}' });
  });

  await page.goto('/products');
  await page.getByLabel('الفرع').selectOption('3');
  await page.getByRole('button', { name: 'طباعة ملصق' }).click();
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  const label = page.locator('[data-product-label]');
  await expect(label).toBeVisible();
  const bars = page.locator('[data-product-label-bars]');
  await expect(bars.locator('svg')).toHaveCount(1);
  await expect(bars).not.toHaveText(/\*/);
  await label.screenshot({ path: testInfo.outputPath('label.png'), scale: 'css' });

  // Font ink can extend outside its CSS line box. Measure the actual glyphs,
  // including Arabic currency and Latin descenders, using the loaded print font.
  const layout = await label.evaluate((element) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const rows = [...element.children];
    const textRows = [rows[0]!, rows[1]!, rows[3]!];
    const text = textRows.flatMap((row) => {
      const nodes = row.children.length ? [...row.children] : [row];
      return nodes.map((node) => {
        const style = getComputedStyle(node);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = context.measureText(node.textContent!);
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        const baseline = box.top + metrics.fontBoundingBoxAscent;
        return {
          value: node.textContent,
          top: baseline - metrics.actualBoundingBoxAscent,
          bottom: baseline + metrics.actualBoundingBoxDescent,
          rowTop: bounds.top,
          rowBottom: bounds.bottom,
        };
      });
    });
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, text };
  });
  expect(layout.width).toBeCloseTo(50 * 96 / 25.4, 1);
  expect(layout.height).toBeCloseTo(25 * 96 / 25.4, 1);
  for (const text of layout.text) {
    expect(text.top, `${text.value}: letters fit below the top of their row`).toBeGreaterThanOrEqual(text.rowTop - 0.25);
    expect(text.bottom, `${text.value}: letters fit above the bottom of their row`).toBeLessThanOrEqual(text.rowBottom + 0.25);
  }
});

import { expect, test } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};

test('empty catalog opens add-category in a dialog', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const fulfill = (data: unknown, extra?: object) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ data, ...extra }),
    });
    if (path === '/auth/session') {
      await fulfill({ actor: { type: 'admin', accountId: 1 } });
      return;
    }
    if (path === '/erp/cashier-sessions/current') {
      await fulfill(null);
      return;
    }
    if (path === '/branches') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [{ id: 3, name: 'الفرع الرئيسي' }],
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      });
      return;
    }
    if (path === '/erp/categories' || path === '/erp/services') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [],
          meta: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/catalog');
  await page.getByLabel('الفرع').selectOption('3');
  await expect(page.getByText('لا توجد تصنيفات بعد')).toBeVisible();
  await page.getByRole('button', { name: 'إضافة أول تصنيف' }).click();
  await expect(page.getByRole('dialog', { name: 'إضافة تصنيف' })).toBeVisible();
});

import { expect, test } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};

test('empty clients list offers add in a dialog', async ({ page }) => {
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
    if (path === '/erp/clients' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [],
          meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/clients');
  await expect(page.getByText('لا يوجد عملاء بعد')).toBeVisible();
  await page.getByRole('button', { name: 'إضافة أول عميل' }).click();
  await expect(page.getByRole('dialog', { name: 'إضافة عميل' })).toBeVisible();
  await expect(page.getByLabel(/^اسم العميل/)).toBeVisible();
});

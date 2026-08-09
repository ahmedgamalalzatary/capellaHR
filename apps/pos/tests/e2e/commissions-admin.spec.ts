import { expect, test, type Route } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const headers = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};
const json = (route: Route, data: unknown, meta?: unknown) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  headers,
  body: JSON.stringify(meta ? { data, meta } : { data }),
});

test('Admin traces monthly commission totals to invoice lines and reversals', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, { actor: { type: 'admin' } });
    if (path === '/branches') return json(route, [{ id: 2, name: 'الرئيسي' }], {
      page: 1, pageSize: 100, total: 1, totalPages: 1,
    });
    if (path === '/erp/commissions') return json(route, [{
      employeeId: 7, employeeCode: 1007, employeeName: 'سارة أحمد', payrollMonth: '2026-08',
      earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
      invoiceLineCount: 3, reversalCount: 1,
    }], { page: 1, pageSize: 20, total: 1, totalPages: 1 });
    if (path === '/erp/commissions/7/2026-08') return json(route, {
      summary: {
        employeeId: 7, employeeCode: 1007, employeeName: 'سارة أحمد', payrollMonth: '2026-08',
        earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
        invoiceLineCount: 3, reversalCount: 1,
      },
      entries: [{
        id: 12, type: 'reversal', invoiceId: 21, invoiceNumber: 'INV-2026.08.03-14.35-17',
        invoiceLineId: 31, lineNumber: 1, serviceName: 'صبغة شعر', baseAmount: '100.00',
        commissionRate: '10.00', amount: '-10.00', reversalId: 41,
        occurredAt: '2026-09-01T09:00:00.000Z',
      }],
    });
    return route.fulfill({ status: 404, headers, body: '{}' });
  });

  await page.goto('/commissions');
  await page.getByLabel('شهر العمولة').fill('2026-08');
  await page.getByLabel('الفرع').selectOption('2');
  await expect(page.getByText('سارة أحمد')).toBeVisible();
  await expect(page.getByText('250.00 ج.م')).toBeVisible();
  await page.getByRole('button', { name: 'التفاصيل' }).click();
  await expect(page.getByText('INV-2026.08.03-14.35-17')).toBeVisible();
  await expect(page.getByText('عكس عمولة')).toBeVisible();
  await expect(page.getByText('#41')).toBeVisible();
});

test('Cashier cannot open commission reporting', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, {
      actor: { type: 'cashier', accountId: 8, employeeId: 17 },
    });
    if (path === '/erp/cashier-sessions/current') return json(route, null);
    return route.fulfill({ status: 404, headers, body: '{}' });
  });

  await page.goto('/commissions');
  await expect(page.getByText('هذا القسم مخصص للمدير فقط.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'العمولات' })).toHaveCount(0);
});

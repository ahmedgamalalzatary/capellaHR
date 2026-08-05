import { expect, test, type Route } from '@playwright/test';

const headers = { 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-origin': 'http://localhost:3001' };
const json = (route: Route, data: unknown, meta?: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(meta ? { data, meta } : { data }) });

test('Admin creates, filters and safely corrects an expense', async ({ page }) => {
  let rows: Record<string, unknown>[] = []; let correction: Record<string, unknown> | undefined; let filters: Record<string, string> = {};
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, { actor: { type: 'admin' } });
    if (path === '/branches') return json(route, [{ id: 2, name: 'الرئيسي' }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
    if (path === '/erp/categories') return json(route, [{ id: 4, branchId: 2, type: 'expense', name: 'تشغيل', isActive: true }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
    if (path === '/erp/expenses' && request.method() === 'GET') { filters = Object.fromEntries(new URL(request.url()).searchParams); return json(route, rows, { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 }); }
    if (path === '/erp/expenses' && request.method() === 'POST') { const body = request.postDataJSON() as Record<string, unknown>; const value = { id: 10, ...body, categoryName: 'تشغيل', actingUsername: 'admin', kind: 'expense', status: 'active', reversalOfId: null, supersedesId: null, correctionReason: null }; rows = [value]; return json(route, value, undefined, 201); }
    if (path === '/erp/expenses/10/corrections') { correction = request.postDataJSON() as Record<string, unknown>; rows = [{ ...rows[0], status: 'corrected' }, { ...rows[0], id: 11, kind: 'reversal', reversalOfId: 10, correctionReason: correction.reason }, { ...rows[0], ...correction, id: 12, status: 'active', supersedesId: 10 }]; return json(route, { original: rows[0], reversal: rows[1], replacement: rows[2] }, undefined, 201); }
    return route.fulfill({ status: 404, headers, body: '{}' });
  });
  await page.goto('/expenses'); await page.getByLabel('الفرع').selectOption('2'); await page.getByLabel('التصنيف', { exact: true }).selectOption('4'); await page.getByLabel('المبلغ').fill('125.50'); await page.getByLabel('تاريخ المصروف').fill('2026-08-05'); await page.getByLabel('الوصف').fill('مستلزمات'); await page.getByRole('button', { name: 'تسجيل المصروف' }).click();
  await expect(page.getByText('مستلزمات')).toBeVisible(); await page.getByLabel('من تاريخ').fill('2026-08-01'); await expect.poll(() => filters).toMatchObject({ branchId: '2', fromDate: '2026-08-01' }); await page.getByRole('button', { name: 'تصحيح' }).click(); await page.getByLabel('المبلغ الصحيح').fill('100'); await page.getByLabel('سبب التصحيح').fill('قيمة خاطئة'); await page.getByRole('button', { name: 'تأكيد التصحيح' }).click();
  await expect.poll(() => correction).toMatchObject({ branchId: 2, amount: '100', reason: 'قيمة خاطئة' }); await expect(page.getByText('قيد عكسي')).toBeVisible();
});

test('Cashier cannot open the Admin expenses workflow', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, { actor: { type: 'cashier', accountId: 8, employeeId: 17 } });
    if (path === '/erp/cashier-sessions/current') return json(route, null);
    return route.fulfill({ status: 404, headers, body: '{}' });
  });
  await page.goto('/expenses');
  await expect(page.getByText('هذا القسم مخصص للمدير فقط.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'المصروفات' })).toHaveCount(0);
});

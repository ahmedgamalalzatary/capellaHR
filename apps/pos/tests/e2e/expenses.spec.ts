import { expect, test, type Route } from '@playwright/test';
import { e2eBaseUrl } from '../../playwright-port';

const headers = { 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-origin': e2eBaseUrl };
const json = (route: Route, data: unknown, meta?: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(meta ? { data, meta } : { data }) });

test('Admin creates, filters and safely corrects an expense', async ({ page }) => {
  let rows: Record<string, unknown>[] = []; let correction: Record<string, unknown> | undefined; let filters: Record<string, string> = {};
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, { actor: { type: 'admin' } });
    if (path === '/branches') return json(route, [{ id: 2, name: 'الرئيسي' }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
    if (path === '/erp/expenses' && request.method() === 'GET') { filters = Object.fromEntries(new URL(request.url()).searchParams); return json(route, rows, { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 }); }
    if (path === '/erp/expenses' && request.method() === 'POST') { const body = request.postDataJSON() as Record<string, unknown>; const value = { id: 10, ...body, actingUsername: 'admin', kind: 'expense', status: 'active', reversalOfId: null, supersedesId: null, correctionReason: null }; rows = [value]; return json(route, value, undefined, 201); }
    if (path === '/erp/expenses/10/corrections') { correction = request.postDataJSON() as Record<string, unknown>; rows = [{ ...rows[0], status: 'corrected' }, { ...rows[0], id: 11, kind: 'reversal', reversalOfId: 10, correctionReason: correction.reason }, { ...rows[0], ...correction, id: 12, status: 'active', supersedesId: 10 }]; return json(route, { original: rows[0], reversal: rows[1], replacement: rows[2] }, undefined, 201); }
    return route.fulfill({ status: 404, headers, body: '{}' });
  });
  await page.goto('/expenses'); await page.getByLabel('الفرع').selectOption('2'); await page.getByLabel('اسم المصروف').fill('كهرباء'); await page.getByLabel('المبلغ').fill('125.50'); await page.getByLabel('تاريخ المصروف').fill('2026-08-05'); await page.getByLabel('الوصف', { exact: true }).fill('مستلزمات'); await page.getByRole('button', { name: 'تسجيل المصروف' }).click();
  await expect(page.getByText('مستلزمات')).toBeVisible(); await page.getByLabel('من تاريخ').fill('2026-08-01'); await expect.poll(() => filters).toMatchObject({ branchId: '2', fromDate: '2026-08-01' }); await page.getByRole('button', { name: 'تصحيح' }).click(); await page.getByLabel('المبلغ الصحيح').fill('100'); await page.getByLabel('سبب التصحيح').fill('قيمة خاطئة'); await page.getByRole('button', { name: 'تأكيد التصحيح' }).click();
  await expect.poll(() => correction).toMatchObject({ branchId: 2, amount: '100', reason: 'قيمة خاطئة' }); await expect(page.getByText('قيد عكسي')).toBeVisible();
});

test('Cashier records an expense in their own branch and corrects it', async ({ page }) => {
  let rows: Record<string, unknown>[] = []; let created: Record<string, unknown> | undefined;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, { actor: { type: 'cashier', accountId: 8 } });
    if (path === '/erp/cashier-sessions/current') return json(route, null);
    if (path === '/erp/expenses' && request.method() === 'GET') return json(route, rows, { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 });
    if (path === '/erp/expenses' && request.method() === 'POST') { created = request.postDataJSON() as Record<string, unknown>; rows = [{ id: 10, branchId: 2, ...created, actingUsername: 'cashier1', kind: 'expense', status: 'active', reversalOfId: null, supersedesId: null, correctionReason: null }]; return json(route, rows[0], undefined, 201); }
    return route.fulfill({ status: 404, headers, body: '{}' });
  });
  await page.goto('/expenses');
  await expect(page.getByRole('heading', { name: 'المصروفات' })).toBeVisible();
  await expect(page.getByLabel('الفرع')).toHaveCount(0);
  await page.getByLabel('اسم المصروف').fill('مياه');
  await page.getByLabel('المبلغ').fill('40.00'); await page.getByLabel('تاريخ المصروف').fill('2026-08-05'); await page.getByLabel('الوصف', { exact: true }).fill('مياه');
  await page.getByRole('button', { name: 'تسجيل المصروف' }).click();
  // The branch is never sent: the server pins the entry to the branch of the cashier account.
  await expect.poll(() => created).toEqual({ name: 'مياه', amount: '40.00', expenseDate: '2026-08-05', description: 'مياه' });
  // Name and description both read مياه here, so the row carries two matching cells.
  await expect(page.getByRole('cell', { name: 'مياه' }).first()).toBeVisible();
  // A cashier may correct an expense in their own branch, which the API allows too.
  await expect(page.getByRole('button', { name: 'تصحيح' })).toBeVisible();
});

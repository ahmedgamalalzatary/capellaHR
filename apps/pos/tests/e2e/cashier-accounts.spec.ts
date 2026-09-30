import { expect, test, type Route } from '@playwright/test';

test('admin creates and edits cashier credentials without employee selection', async ({ page }, testInfo) => {
  const account = {
    id: 1, username: 'nasr', role: 'cashier', branchId: 3, branchName: 'فرع مدينة نصر', active: true,
  };
  let rows = [account];
  let saved: Record<string, unknown> | undefined;
  const json = (route: Route, data: unknown, paged = false) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, ...(paged ? { meta: { page: 1, pageSize: 100, total: (data as unknown[]).length, totalPages: 1 } } : {}) }) });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/auth/session') return json(route, { actor: { type: 'admin' } });
    if (path === '/auth/cashier-accounts' && request.method() === 'GET') return json(route, rows, true);
    if (path === '/auth/cashier-accounts' && request.method() === 'PUT') {
      saved = request.postDataJSON() as Record<string, unknown>;
      if (saved.mode === 'edit') rows = [{ ...account, username: saved.username as string }];
      else rows.push({ ...account, id: 2, branchId: 4, branchName: 'فرع المعادي', username: saved.username as string });
      return json(route, rows.at(-1));
    }
    if (path === '/branches') return json(route, [{ id: 3, name: 'فرع مدينة نصر' }, { id: 4, name: 'فرع المعادي' }], true);
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.goto('/cashier-accounts');
  await page.screenshot({ path: testInfo.outputPath('accounts.png'), fullPage: true });
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('الفرع')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('edit-credentials.png'), fullPage: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('اسم المستخدم').fill('nasr.new');
  await dialog.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toEqual({ mode: 'edit', accountId: 1, branchId: 3, username: 'nasr.new' });
  await expect(page.getByRole('cell', { name: 'nasr.new', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'إضافة حساب كاشير' }).click();
  await dialog.getByLabel('الفرع').selectOption('4');
  await dialog.getByLabel('اسم المستخدم').fill('maadi');
  await dialog.locator('#cashier-password').fill('secret');
  await dialog.getByRole('button', { name: 'حفظ الحساب' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toMatchObject({ mode: 'create', branchId: 4, username: 'maadi', password: 'secret' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'تعديل', exact: true }).first().click();
  await expect(dialog.getByRole('button', { name: 'حفظ التغييرات' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-edit.png'), fullPage: true });
});

import { expect, test, type Route } from '@playwright/test';

test('admin creates and edits a cashier with employees in one form', async ({ page }, testInfo) => {
  const employeeOptions = [{ id: 7, fullName: 'أحمد جمال', employeeCode: 1007 }, { id: 9, fullName: 'سارة محمد', employeeCode: 1009 }];
  const account = { id: 1, username: 'nasr', role: 'cashier', branchId: 3, branchName: 'فرع مدينة نصر', active: true };
  let rows = [account];
  let selected = [7];
  let saved: Record<string, unknown> | undefined;
  const json = (route: Route, data: unknown, paged = false) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, ...(paged ? { meta: { page: 1, pageSize: 100, total: (data as unknown[]).length, totalPages: 1 } } : {}) }) });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/auth/session') return json(route, { actor: { type: 'admin' } });
    if (path === '/auth/cashier-accounts' && request.method() === 'GET') return json(route, rows, true);
    if (path === '/auth/cashier-accounts' && request.method() === 'PUT') {
      saved = request.postDataJSON() as Record<string, unknown>;
      selected = saved.employeeIds as number[];
      if (saved.mode === 'edit') rows = [{ ...account, username: saved.username as string }];
      else rows.push({ ...account, id: 2, branchId: 4, branchName: 'فرع المعادي', username: saved.username as string });
      return json(route, rows.at(-1));
    }
    if (path === '/branches') return json(route, [{ id: 3, name: 'فرع مدينة نصر' }, { id: 4, name: 'فرع المعادي' }], true);
    if (path === '/employees') return json(route, employeeOptions, true);
    if (path === '/erp/branch-cashier-roster') return json(route, employeeOptions.filter(({ id }) => selected.includes(id)));
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.goto('/cashier-accounts');
  await expect(page.getByRole('cell', { name: 'أحمد جمال', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('accounts.png'), fullPage: true });
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('الفرع')).toBeDisabled();
  await dialog.getByRole('button', { name: /الموظفون المسموح لهم بالبيع/ }).click();
  await dialog.getByRole('searchbox').fill('سارة');
  await dialog.getByRole('checkbox', { name: 'سارة محمد' }).check();
  await page.screenshot({ path: testInfo.outputPath('edit-employees.png'), fullPage: true });
  await dialog.getByRole('checkbox', { name: 'سارة محمد' }).press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('اسم المستخدم').fill('nasr.new');
  await dialog.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toEqual({ mode: 'edit', accountId: 1, branchId: 3, username: 'nasr.new', employeeIds: [7, 9] });
  await expect(page.getByRole('cell', { name: 'nasr.new', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'إضافة حساب كاشير' }).click();
  await dialog.getByLabel('الفرع').selectOption('4');
  await dialog.getByLabel('اسم المستخدم').fill('maadi');
  await dialog.getByLabel('كلمة المرور', { exact: true }).fill('secret');
  await dialog.getByRole('button', { name: 'حفظ الحساب' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toMatchObject({ mode: 'create', branchId: 4, username: 'maadi', password: 'secret', employeeIds: [7, 9] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'تعديل', exact: true }).first().click();
  await dialog.getByRole('button', { name: /الموظفون المسموح لهم بالبيع/ }).click();
  await expect(dialog.getByRole('button', { name: 'حفظ التغييرات' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-edit.png'), fullPage: true });
});

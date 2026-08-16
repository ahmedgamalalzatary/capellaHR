import { expect, test, type Route } from '@playwright/test';

const json = (route: Route, data: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ data }),
});

test('Admin navigation connects related ERP workspaces without page overflow', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/session') return json(route, { actor: { type: 'admin', accountId: 1 } });
    return json(route, null, 404);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'لوحة الإدارة' })).toBeVisible();

  const workspaces = [
    { link: 'الكتالوج', path: '/catalog', heading: 'إدارة الكتالوج' },
    { link: 'العملاء', path: '/clients', heading: 'إدارة العملاء' },
    { link: 'حسابات الكاشير', path: '/cashier-accounts', heading: 'حسابات كاشير الفروع' },
    { link: 'العمولات', path: '/commissions', heading: 'العمولات' },
    { link: 'التقارير', path: '/reports', heading: 'التقارير والتصدير' },
  ] as const;

  for (const workspace of workspaces) {
    await page.getByRole('navigation', { name: 'التنقل الرئيسي' })
      .getByRole('link', { name: workspace.link, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${workspace.path}$`));
    await expect(page.getByRole('heading', { level: 1, name: workspace.heading })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
});

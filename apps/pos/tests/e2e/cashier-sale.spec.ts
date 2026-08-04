import { expect, test, type Route } from '@playwright/test';

import { cashierLoginSchema } from '@capella/contracts';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': 'http://localhost:3001',
};

const sessionCookie = 'capella_session';
const sessionToken = 'cashier-e2e-session';

const json = (route: Route, data: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify({ data }),
});

test('Cashier logs in, restores the open session, and completes a service sale', async ({ page }) => {
  let openSession = false;
  let authenticatedSessionReads = 0;
  let completedSale: Record<string, unknown> | undefined;

  const actor = { actor: { type: 'cashier', accountId: 8, employeeId: 17 } };
  const session = {
    id: 14,
    branchId: 3,
    branchName: 'الفرع الرئيسي',
    openedByAccountId: 8,
    openedByUsername: 'cashier.one',
    openedAt: '2026-08-04T09:30:00.000Z',
    closedAt: null,
    closedByAccountId: null,
    closedByUsername: null,
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const hasSessionCredential = request.headers().cookie?.split(';').some(
      (part) => part.trim() === `${sessionCookie}=${sessionToken}`,
    ) ?? false;
    if (path === '/auth/cashier/login' && request.method() === 'POST') {
      let payload: unknown;
      try {
        payload = request.postDataJSON();
      } catch {
        payload = null;
      }
      const parsed = cashierLoginSchema.safeParse(payload);
      if (!parsed.success
        || parsed.data.username !== 'cashier.one'
        || parsed.data.password !== 'correct-horse-battery-staple') {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        headers: {
          ...corsHeaders,
          'set-cookie': `${sessionCookie}=${sessionToken}; Path=/; HttpOnly; SameSite=Strict`,
        },
        body: JSON.stringify({ data: actor }),
      });
      return;
    }
    if (path === '/auth/session') {
      if (!hasSessionCredential) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'يلزم تسجيل الدخول' } }),
        });
        return;
      }
      authenticatedSessionReads += 1;
      await json(route, actor);
      return;
    }
    if (path.startsWith('/erp/') && !hasSessionCredential) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }),
      });
      return;
    }
    if (path === '/erp/cashier-sessions/current') {
      await json(route, openSession ? session : null);
      return;
    }
    if (path === '/erp/cashier-sessions/open' && request.method() === 'POST') {
      openSession = true;
      await json(route, session);
      return;
    }
    if (path === '/erp/clients') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [{ id: 5, branchId: 3, fullName: 'منى أحمد', phone: '01012345678', createdAt: '', updatedAt: '' }],
          meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
        }),
      });
      return;
    }
    if (path === '/erp/services') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [{
            id: 21, branchId: 3, categoryId: 2, categoryName: 'شعر', categoryIsActive: true,
            name: 'صبغة شعر', description: null, price: '200.00', commissionPercent: '10.00',
            isActive: true, createdAt: '', updatedAt: '',
          }],
          meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
        }),
      });
      return;
    }
    if (path === '/erp/assignable-employees') {
      await json(route, [{ id: 18, employeeCode: 1018, fullName: 'سارة علي', branchId: 3 }]);
      return;
    }
    if (path === '/erp/sales/quote' && request.method() === 'POST') {
      await json(route, {
        lines: [{ itemType: 'service', sourceId: 21, name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00' }],
        discount: null,
        tax: null,
        totals: { subtotal: '200.00', discountAmount: '0.00', taxAmount: '0.00', total: '200.00' },
      });
      return;
    }
    if (path === '/erp/sales' && request.method() === 'POST') {
      completedSale = request.postDataJSON() as Record<string, unknown>;
      await json(route, { id: 44, invoiceNumber: 'INV-2026.08.04-12.35-17', totals: { total: '200.00' } });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/login');
  const unauthenticatedStatuses = await page.evaluate(async () => {
    const invalidLogin = await fetch('http://localhost:4000/api/v1/auth/cashier/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cashier.one', password: 'wrong-password' }),
    });
    const malformedLogin = await fetch('http://localhost:4000/api/v1/auth/cashier/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    const protectedRequest = await fetch('http://localhost:4000/api/v1/erp/cashier-sessions/current', {
      credentials: 'include',
    });
    return [invalidLogin.status, malformedLogin.status, protectedRequest.status];
  });
  expect(unauthenticatedStatuses).toEqual([401, 401, 401]);
  await page.getByLabel('اسم المستخدم').fill('cashier.one');
  await page.getByLabel('كلمة المرور').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

  await expect(page.getByRole('heading', { name: 'وردية الكاشير' })).toBeVisible();
  await page.getByRole('button', { name: 'فتح الوردية' }).click();
  await expect(page.getByText('مفتوحة', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: 'بدء بيع جديد' })).toBeVisible();
  expect(authenticatedSessionReads).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'بدء بيع جديد' }).click();

  await page.getByLabel('ابحث عن العميل برقم الهاتف أو الاسم').fill('منى');
  await page.getByRole('button', { name: /منى أحمد/ }).click();
  await page.getByRole('button', { name: /صبغة شعر/ }).click();
  await page.getByRole('button', { name: /سارة علي/ }).click();
  await expect(page.getByText('تم سداد الإجمالي بالكامل')).toBeVisible();
  await page.getByRole('button', { name: 'مراجعة وإتمام البيع' }).click();
  await page.getByRole('button', { name: 'تأكيد البيع' }).click();

  await expect(page.getByRole('heading', { name: 'تم حفظ الفاتورة' })).toBeVisible();
  await expect(page.getByText('INV-2026.08.04-12.35-17')).toBeVisible();
  expect(completedSale).toMatchObject({
    clientId: 5,
    assignedEmployeeId: 18,
    cashierSessionId: 14,
    lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
    payments: [{ method: 'cash', amount: '200.00' }],
  });
});

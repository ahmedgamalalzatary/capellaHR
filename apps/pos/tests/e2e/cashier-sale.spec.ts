import { expect, test, type Route } from '@playwright/test';

import { cashierLoginSchema } from '@capella/contracts';
import { e2eBaseUrl } from '../../playwright-port';

const posOrigin = e2eBaseUrl;

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': posOrigin,
};

const sessionCookie = 'capella_session';
const sessionToken = 'cashier-e2e-session';

const json = (route: Route, data: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify({ data }),
});

test('Cashier completes a mixed sale and sees a stable last-unit stock conflict', async ({ page }) => {
  let openSession = false;
  let authenticatedSessionReads = 0;
  let completedSale: Record<string, unknown> | undefined;
  let completedSaleRequests = 0;

  const actor = { actor: { type: 'cashier', accountId: 8 } };
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
  const storedInvoice = {
    id: 44,
    invoiceNumber: 'INV-2026.08.04-12.35-17',
    status: 'completed',
    branchId: 3,
    cashierSessionId: 14,
    client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
    seller: { id: 17, employeeCode: 1017, name: 'أحمد جمال' },
    authorizedBy: { accountId: 8, username: 'cashier.one' },
    lines: [
      {
        id: 81, lineNumber: 1, itemType: 'service', sourceId: 21,
        name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00',
        employee: { id: 18, employeeCode: 1018, name: 'سارة علي' },
        commissionRule: 'service_default', commissionRate: '10.00',
        commissionAmount: '20.00', productCostBasis: null,
        refundedQuantity: 0, refundableQuantity: 1,
      },
      {
        id: 82, lineNumber: 2, itemType: 'product', sourceId: 31,
        name: 'شامبو', quantity: 1, unitPrice: '50.00', lineTotal: '50.00',
        employee: null,
        commissionRule: 'none', commissionRate: '0.00',
        commissionAmount: '0.00', productCostBasis: '25.00',
        refundedQuantity: 0, refundableQuantity: 1,
      },
    ],
    discount: null,
    tax: null,
    totals: {
      subtotal: '250.00', discountAmount: '0.00', taxAmount: '0.00',
      total: '250.00', paymentTotal: '250.00',
    },
    payments: [{
      method: 'cash', amount: '250.00', refundedAmount: '0.00', refundableAmount: '250.00',
    }],
    reversals: [],
    eligibility: { canVoid: true, canRefund: true },
    soldAt: '2026-08-04T09:35:00.000Z',
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
    if (path === '/erp/products') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [{
            id: 31, branchId: 3, name: 'شامبو', description: null,
            sellingPrice: '50.00', isActive: true, quantity: 1,
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
    if (path === '/erp/branch-cashier-roster') {
      await json(route, [{ id: 17, employeeCode: 1017, fullName: 'أحمد جمال' }]);
      return;
    }
    if (path === '/erp/sales/quote' && request.method() === 'POST') {
      const payload = request.postDataJSON() as {
        lines: Array<{
          itemType: 'service' | 'product';
          serviceId?: number;
          productId?: number;
          quantity: number;
          unitPrice?: string;
        }>;
      };
      const lines = payload.lines.map((line) => ({
        itemType: line.itemType,
        sourceId: line.itemType === 'product' ? line.productId : line.serviceId,
        name: line.itemType === 'product' ? 'شامبو' : 'صبغة شعر',
        quantity: line.quantity,
        unitPrice: line.itemType === 'product' ? '50.00' : '200.00',
        lineTotal: line.itemType === 'product' ? '50.00' : '200.00',
      }));
      const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0).toFixed(2);
      await json(route, {
        lines,
        discount: null,
        tax: null,
        totals: { subtotal, discountAmount: '0.00', taxAmount: '0.00', total: subtotal },
      });
      return;
    }
    if (path === '/erp/sales' && request.method() === 'POST') {
      completedSaleRequests += 1;
      completedSale = request.postDataJSON() as Record<string, unknown>;
      if (completedSaleRequests > 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: { code: 'INSUFFICIENT_STOCK', message: 'تم بيع آخر وحدة من شامبو. حدّث السلة وحاول مرة أخرى.' } }),
        });
        return;
      }
      // The API answers a completed sale with the whole invoice, and the success
      // screen prints a receipt from it, so the stub must carry its lines.
      await json(route, storedInvoice);
      return;
    }
    if (path === '/erp/sales' && request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [{
            id: storedInvoice.id,
            invoiceNumber: storedInvoice.invoiceNumber,
            status: storedInvoice.status,
            total: storedInvoice.totals.total,
            client: { id: storedInvoice.client.id, name: storedInvoice.client.name },
            employees: [{
              id: storedInvoice.lines[0]!.employee!.id,
              name: storedInvoice.lines[0]!.employee!.name,
            }],
            soldAt: storedInvoice.soldAt,
          }],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      });
      return;
    }
    if (path === '/erp/sales/44' && request.method() === 'GET') {
      await json(route, storedInvoice);
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
  await page.getByRole('button', { name: /شامبو/ }).click();
  await page.getByLabel('الكاشير').selectOption('17');
  await page.getByRole('button', { name: /سارة علي/ }).click();
  await expect(page.getByText('تم سداد الإجمالي بالكامل')).toBeVisible();
  await page.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }).click();
  await page.getByRole('button', { name: 'تأكيد البيع' }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByRole('heading', { name: 'تم حفظ الفاتورة' })).toBeVisible();
  // Shown twice now: once in the confirmation and once on the printable receipt.
  await expect(page.getByText('INV-2026.08.04-12.35-17').first()).toBeVisible();
  // The sale offers to print straight away; declining leaves the confirmation card.
  await page.getByRole('button', { name: 'لا، شكراً' }).click();
  await page.getByRole('link', { name: 'عرض الإيصال' }).click();
  await expect(page.getByRole('button', { name: 'طباعة الإيصال' })).toBeVisible();
  expect(await page.evaluate(() => Array.from(document.styleSheets).some((sheet) => {
    try {
      return Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('80mm'));
    } catch {
      return false;
    }
  }))).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(window, 'print', {
      value: () => sessionStorage.setItem(
        'receipt-print-count',
        String(Number(sessionStorage.getItem('receipt-print-count') ?? '0') + 1),
      ),
    });
  });
  await page.getByRole('button', { name: 'طباعة الإيصال' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('receipt-print-count'))).toBe('1');
  await page.getByRole('link', { name: 'العودة إلى الفواتير' }).click();
  await page.getByRole('link', { name: 'INV-2026.08.04-12.35-17' }).click();
  await page.getByRole('button', { name: 'طباعة الإيصال' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('receipt-print-count'))).toBe('2');
  expect(completedSaleRequests).toBe(1);
  expect(completedSale).toMatchObject({
    clientId: 5,
    sellerEmployeeId: 17,
    cashierSessionId: 14,
    lines: [
      { itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 18 },
      { itemType: 'product', productId: 31, quantity: 1 },
    ],
    payments: [{ method: 'cash', amount: '250.00' }],
  });

  await page.goto('/sales');
  await page.getByLabel('ابحث عن العميل برقم الهاتف أو الاسم').fill('منى');
  await page.getByRole('button', { name: /منى أحمد/ }).click();
  await page.getByRole('button', { name: /شامبو/ }).click();
  await page.getByLabel('الكاشير').selectOption('17');
  await page.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }).click();
  await page.getByRole('button', { name: 'تأكيد البيع' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'تم بيع آخر وحدة من شامبو' })).toBeVisible();
  expect(completedSaleRequests).toBe(2);
});

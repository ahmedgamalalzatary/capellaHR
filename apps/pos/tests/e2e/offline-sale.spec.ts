import { expect, test, type Route } from '@playwright/test';
import { e2eBaseUrl } from '../../playwright-port';

const posOrigin = e2eBaseUrl;
const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': posOrigin,
};

const json = (route: Route, data: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify({ data }),
});

test('offline sale survives reload, reconnects once, and resolves a permanent conflict', async ({
  context,
  page,
}) => {
  const originalKey = '11111111-1111-4111-8111-111111111111';
  const owner = { accountId: 8, role: 'cashier', branchId: 3, cashierSessionId: 14 } as const;
  const input = {
    clientId: 5,
    sellerEmployeeId: 17,
    cashierSessionId: 14,
    idempotencyKey: originalKey,
    lines: [{
      itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '185.00', employeeId: 18,
    }],
    payments: [{ method: 'cash', amount: '185.00' }],
  } as const;
  const queued = {
    version: 1,
    owner,
    input,
    state: 'pending',
    attempts: 0,
    createdAt: 1,
    updatedAt: 1,
    failure: null,
    recoveryDraft: {
      client: { id: 5, branchId: 3 },
      employee: { id: 18, employeeCode: 1018, fullName: 'سارة علي', branchId: 3 },
      seller: { id: 17, employeeCode: 1017, fullName: 'أحمد جمال' },
      lines: [{
        service: {
          id: 21,
          branchId: 3,
          categoryId: 2,
          categoryName: 'شعر',
          categoryIsActive: true,
          name: 'صبغة شعر',
          description: null,
          price: '185.00',
          commissionPercent: '10.00',
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        quantity: 1,
        unitPrice: '185.00',
        itemType: 'service',
      }],
      discountKind: 'percentage',
      discountValue: '',
      taxKind: 'percentage',
      taxValue: '',
      payments: { cash: '185.00', visa: '', instapay: '', vodafone_cash: '' },
      paymentsTouched: false,
      idempotencyKey: originalKey,
    },
  };
  await context.addCookies([{
    name: 'capella_session',
    value: 'cashier-offline-e2e-session',
    domain: 'localhost',
    path: '/',
  }]);
  await page.addInitScript(({ storageKey, seedMarker, record }) => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => Boolean(Reflect.get(window, '__capellaE2eOnline')),
    });
    Reflect.set(window, '__capellaE2eOnline', false);
    if (!localStorage.getItem(seedMarker)) {
      localStorage.setItem(storageKey, JSON.stringify(record));
      localStorage.setItem(seedMarker, '1');
    }
  }, {
    storageKey: `capella:offline-sale:v1:${originalKey}`,
    seedMarker: 'capella:e2e:offline-sale-seeded',
    record: queued,
  });

  const attempts = new Map<string, number>();
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (path === '/auth/session') {
      await json(route, { actor: { type: 'cashier', accountId: 8 } });
      return;
    }
    if (path === '/erp/cashier-sessions/current') {
      await json(route, {
        id: 14,
        branchId: 3,
        branchName: 'الفرع الرئيسي',
        openedByAccountId: 8,
        openedByUsername: 'cashier.one',
        openedAt: '2026-08-08T09:30:00.000Z',
        closedAt: null,
        closedByAccountId: null,
        closedByUsername: null,
      });
      return;
    }
    if (path === '/erp/clients') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [{
            id: 5,
            branchId: 3,
            fullName: 'منى أحمد',
            phone: '01012345678',
            createdAt: '',
            updatedAt: '',
          }],
          meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
        }),
      });
      return;
    }
    if (path === '/erp/services' || path === '/erp/products') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          data: [],
          meta: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
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
      await json(route, {
        lines: [{
          itemType: 'service',
          sourceId: 21,
          name: 'صبغة شعر',
          quantity: 1,
          unitPrice: '185.00',
          lineTotal: '185.00',
        }],
        discount: null,
        tax: null,
        totals: {
          subtotal: '185.00',
          discountAmount: '0.00',
          taxAmount: '0.00',
          total: '185.00',
        },
      });
      return;
    }
    if (path === '/erp/sales' && request.method() === 'POST') {
      const submitted = request.postDataJSON() as { idempotencyKey: string };
      attempts.set(submitted.idempotencyKey, (attempts.get(submitted.idempotencyKey) ?? 0) + 1);
      if (submitted.idempotencyKey === originalKey) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            error: { code: 'PRICE_CHANGED', message: 'تغير السعر أثناء انقطاع الاتصال' },
          }),
        });
        return;
      }
      await json(route, {
        id: 44,
        invoiceNumber: 'INV-OFFLINE-44',
        totals: { total: '185.00' },
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/sales');
  await expect(page.getByText('بانتظار الاتصال')).toBeVisible();
  await page.reload();
  await expect(page.getByText('بانتظار الاتصال')).toBeVisible();

  await page.evaluate(() => {
    Reflect.set(window, '__capellaE2eOnline', true);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText('يحتاج البيع إلى مراجعة')).toBeVisible();
  expect(attempts.get(originalKey)).toBe(1);

  await page.getByRole('button', { name: 'مراجعة وتعديل البيع' }).click();
  await expect(page.getByText(/تم استعادة البيع للمراجعة/)).toBeVisible();
  await page.getByLabel('ابحث عن العميل برقم الهاتف أو الاسم').fill('منى');
  await page.getByRole('button', { name: /منى أحمد/ }).click();
  await page.getByRole('button', { name: 'مراجعة وإتمام البيع + طباعة' }).click();
  await page.getByRole('button', { name: 'تأكيد البيع' }).click();

  await expect(page.getByRole('heading', { name: 'تم حفظ الفاتورة' })).toBeVisible();
  expect(attempts.size).toBe(2);
  expect([...attempts.values()]).toEqual([1, 1]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(
    (key) => key.startsWith('capella:offline-sale:v1:'),
  ))).toEqual([]);
});

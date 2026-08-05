import { expect, test, type Route } from '@playwright/test';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-origin': 'http://localhost:3001',
};
const json = (route: Route, data: unknown, meta?: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: corsHeaders,
  body: JSON.stringify(meta ? { data, meta } : { data }),
});

test('Admin creates, edits, and adjusts a branch product', async ({ page }) => {
  let product: Record<string, unknown> | undefined;
  let createdPayload: Record<string, unknown> | undefined;
  let updatedPayload: Record<string, unknown> | undefined;
  let adjustmentPayload: Record<string, unknown> | undefined;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (path === '/auth/session') {
      await json(route, { actor: { type: 'admin' } });
      return;
    }
    if (path === '/branches') {
      await json(route, [{ id: 3, name: 'الفرع الرئيسي' }], {
        page: 1, pageSize: 100, total: 1, totalPages: 1,
      });
      return;
    }
    if (path === '/erp/products' && request.method() === 'GET') {
      await json(route, product ? [product] : [], {
        page: 1, pageSize: 100, total: product ? 1 : 0, totalPages: product ? 1 : 0,
      });
      return;
    }
    if (path === '/erp/products/movements') {
      await json(route, [], { page: 1, pageSize: 20, total: 0, totalPages: 0 });
      return;
    }
    if (path === '/erp/products' && request.method() === 'POST') {
      createdPayload = request.postDataJSON() as Record<string, unknown>;
      product = {
        id: 31, ...createdPayload, description: createdPayload.description ?? null,
        isActive: true, quantity: 0,
        createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
      };
      await json(route, product, undefined, 201);
      return;
    }
    if (path === '/erp/products/31' && request.method() === 'PATCH') {
      updatedPayload = request.postDataJSON() as Record<string, unknown>;
      product = { ...product, ...updatedPayload };
      await json(route, product);
      return;
    }
    if (path === '/erp/products/31/adjustments' && request.method() === 'POST') {
      adjustmentPayload = request.postDataJSON() as Record<string, unknown>;
      product = { ...product, quantity: Number(product?.quantity) + Number(adjustmentPayload.quantityDelta) };
      await json(route, { product, movementId: 8 });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/products');
  await page.getByLabel('الفرع').selectOption('3');
  await page.getByLabel('اسم المنتج').fill('شامبو');
  await page.getByLabel('وصف المنتج').fill('للشعر الجاف');
  await page.getByLabel('سعر البيع').fill('50');
  await page.getByLabel('آخر تكلفة شراء').fill('30');
  await page.getByLabel('حد المخزون المنخفض').fill('2');
  await page.getByRole('button', { name: 'إضافة منتج' }).click();
  await expect(page.getByRole('cell', { name: /شامبو/ })).toBeVisible();
  expect(createdPayload).toMatchObject({ branchId: 3, name: 'شامبو', sellingPrice: '50' });

  await page.getByRole('button', { name: 'تعديل' }).click();
  await page.getByLabel('سعر البيع').fill('55');
  await page.getByRole('button', { name: 'حفظ التعديل' }).click();
  await expect.poll(() => updatedPayload?.sellingPrice).toBe('55');

  await page.getByRole('button', { name: 'تسوية' }).click();
  await page.getByLabel('تغيير الكمية').fill('3');
  await page.getByLabel('ملاحظة التسوية').fill('جرد افتتاحي');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => adjustmentPayload).toMatchObject({
    branchId: 3, quantityDelta: 3, reason: 'count_correction', note: 'جرد افتتاحي',
  });
  await expect(page.getByRole('cell', { name: '3', exact: true })).toBeVisible();
});

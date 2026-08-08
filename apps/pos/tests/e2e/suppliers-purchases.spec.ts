import { expect, test, type Route } from '@playwright/test';

const headers = { 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-origin': `http://localhost:${process.env.POS_E2E_PORT ?? 3001}` };
const json = (route: Route, data: unknown, meta?: unknown, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(meta ? { data, meta } : { data }) });

test('Admin manages a supplier, posts exact purchase stock facts, and cancels once', async ({ page }) => {
  let supplier: Record<string, unknown> | undefined; let purchase: Record<string, unknown> | undefined; let postPayload: Record<string, unknown> | undefined; let cancelPayload: Record<string, unknown> | undefined; const supplierUpdates: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, { actor: { type: 'admin' } });
    if (path === '/branches') return json(route, [{ id: 2, name: 'الرئيسي' }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
    if (path === '/erp/products') return json(route, [{ id: 4, branchId: 2, name: 'شامبو', isActive: true }], { page: 1, pageSize: 100, total: 1, totalPages: 1 });
    if (path === '/erp/suppliers' && request.method() === 'GET') return json(route, supplier ? [supplier] : [], { page: 1, pageSize: 100, total: supplier ? 1 : 0, totalPages: supplier ? 1 : 0 });
    if (path === '/erp/suppliers' && request.method() === 'POST') { supplier = { id: 3, ...request.postDataJSON(), phone: null, notes: null, isActive: true, createdAt: '2026-08-05T10:00:00Z', updatedAt: '2026-08-05T10:00:00Z' }; return json(route, supplier, undefined, 201); }
    if (path === '/erp/suppliers/3' && request.method() === 'PATCH') { const payload = request.postDataJSON() as Record<string, unknown>; supplierUpdates.push(payload); supplier = { ...supplier, ...payload }; return json(route, supplier); }
    if (path === '/erp/suppliers/purchases' && request.method() === 'GET') return json(route, purchase ? [purchase] : [], { page: 1, pageSize: 20, total: purchase ? 1 : 0, totalPages: purchase ? 1 : 0 });
    if (path === '/erp/suppliers/purchases' && request.method() === 'POST') { postPayload = request.postDataJSON(); purchase = { id: 9, branchId: 2, supplierId: 3, supplierName: 'مورد النيل', status: 'posted', purchaseDate: '2026-08-05', total: '25.00', actingAccountId: 1, actingUsername: 'admin', cancelledAt: null, cancelledByAccountId: null, cancellationReason: null, correctsPurchaseId: null, correctedByPurchaseId: null, createdAt: '2026-08-05T10:00:00Z', lines: [{ id: 1, purchaseId: 9, branchId: 2, productId: 4, productNameSnapshot: 'شامبو', quantity: 2, unitCost: '12.50', previousUnitCost: '8.00', lineTotal: '25.00', postedBalanceAfter: 7, cancellationBalanceAfter: null }] }; return json(route, purchase, undefined, 201); }
    if (path === '/erp/suppliers/purchases/9/cancel') { const payload = request.postDataJSON() as Record<string, unknown>; cancelPayload = payload; purchase = { ...purchase, status: 'cancelled', cancellationReason: String(payload.reason), lines: (purchase?.lines as Array<Record<string, unknown>>).map((line) => ({ ...line, cancellationBalanceAfter: 5 })) }; return json(route, purchase); }
    return route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/suppliers'); await page.getByLabel('الفرع').selectOption('2'); await page.getByLabel('اسم المورد').fill('مورد النيل'); await page.getByRole('button', { name: 'إضافة المورد' }).click(); await expect(page.getByRole('cell', { name: 'مورد النيل' })).toBeVisible();
  await page.getByRole('button', { name: 'تعديل' }).click(); await page.getByLabel('اسم المورد').fill('مورد النيل المحدث'); await page.getByRole('button', { name: 'حفظ المورد' }).click(); await expect(page.getByRole('cell', { name: 'مورد النيل المحدث' })).toBeVisible();
  await page.getByRole('button', { name: 'إيقاف' }).click(); await expect(page.getByRole('cell', { name: 'متوقف' })).toBeVisible(); await page.getByRole('button', { name: 'تفعيل' }).click(); await expect(page.getByRole('cell', { name: 'نشط' })).toBeVisible();
  await expect.poll(() => supplierUpdates).toEqual([
    expect.objectContaining({ branchId: 2, name: 'مورد النيل المحدث' }),
    { branchId: 2, isActive: false },
    { branchId: 2, isActive: true },
  ]);
  await page.getByLabel('المورد للمشتريات').selectOption('3'); await page.getByRole('combobox', { name: 'المنتج', exact: true }).selectOption('4'); await page.getByLabel('الكمية', { exact: true }).fill('2'); await page.getByLabel('تكلفة الوحدة', { exact: true }).fill('12.50'); await expect(page.getByText('الإجمالي: 25.00 ج.م')).toBeVisible(); await page.getByRole('button', { name: 'ترحيل المشتريات' }).click();
  await expect.poll(() => postPayload).toMatchObject({ branchId: 2, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/), supplierId: 3, lines: [{ productId: 4, quantity: 2, unitCost: '12.50' }] }); await expect(page.getByRole('cell', { name: 'مُرحّلة' })).toBeVisible(); await expect(page.getByText(/الرصيد بعد الترحيل 7/)).toBeVisible();
  await page.getByRole('button', { name: 'إلغاء المشتريات' }).click(); await page.getByLabel('سبب الإلغاء').fill('خطأ في الكمية'); await page.getByRole('button', { name: 'تأكيد الإلغاء' }).click(); await expect.poll(() => cancelPayload).toMatchObject({ branchId: 2, reason: 'خطأ في الكمية' }); await expect(page.getByText(/ملغاة — خطأ في الكمية/)).toBeVisible(); await expect(page.getByText(/وبعد الإلغاء 5/)).toBeVisible();
});

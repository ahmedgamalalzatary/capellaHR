import { expect, test } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};

test('arrived stays on the diary and cancel asks first', async ({ page }) => {
  let statusPayload: { status?: string } | undefined;
  const booking = {
    id: 9,
    branchId: 3,
    client: { id: 11, fullName: 'منى أحمد', phone: '01000000000' },
    scheduledAt: '2026-08-25T07:30:00.000Z',
    status: 'booked',
    note: null,
    invoiceId: null,
    services: [{
      serviceId: 3, serviceName: 'صبغة شعر', servicePrice: '200.00',
      preferredEmployee: { id: 7, name: 'سارة' },
    }],
    createdAt: '2026-08-24T08:00:00.000Z',
    updatedAt: '2026-08-24T08:00:00.000Z',
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const fulfill = (data: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ data }),
    });
    if (path === '/auth/session') {
      await fulfill({ actor: { type: 'cashier', accountId: 8 } });
      return;
    }
    if (path === '/erp/cashier-sessions/current') {
      await fulfill({
        id: 14, branchId: 3, branchName: 'الفرع الرئيسي',
        openedByAccountId: 8, openedByUsername: 'cashier.one',
        openedAt: '2026-08-04T09:30:00.000Z',
      });
      return;
    }
    if (path === '/erp/bookings/employee-options') {
      await fulfill([{ id: 7, name: 'سارة' }]);
      return;
    }
    if (path === '/erp/bookings' && request.method() === 'GET') {
      await fulfill([{ ...booking, status: statusPayload?.status === 'arrived' ? 'arrived' : booking.status }]);
      return;
    }
    if (path === '/erp/bookings/9/status' && request.method() === 'PATCH') {
      statusPayload = request.postDataJSON() as { status?: string };
      await fulfill({ ...booking, status: statusPayload.status });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', headers: corsHeaders, body: '{}' });
  });

  await page.goto('/bookings');
  await expect(page.getByRole('heading', { name: 'دفتر المواعيد' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'اليوم', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'وصل العميل' }).click();
  await expect(page.getByRole('link', { name: 'بدء البيع' })).toBeVisible();
  await expect(page).toHaveURL(/\/bookings/);

  await page.getByRole('button', { name: 'إلغاء' }).click();
  await expect(page.getByRole('dialog', { name: 'إلغاء الموعد' })).toBeVisible();
  await page.getByRole('button', { name: 'تأكيد الإلغاء' }).click();
  await expect.poll(() => statusPayload?.status).toBe('cancelled');
});

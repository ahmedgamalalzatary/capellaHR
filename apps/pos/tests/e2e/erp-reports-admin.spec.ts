import { expect, test, type Route } from '@playwright/test';

import { e2eBaseUrl } from '../../playwright-port';

const headers = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-origin': e2eBaseUrl,
};
const json = (route: Route, data: unknown, meta?: unknown) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  headers,
  body: JSON.stringify(meta ? { data, meta } : { data }),
});

const exportRecord = {
  id: 9, reportType: 'erp-sales', status: 'failed', filters: { branchId: 2 },
  selection: { mode: 'all' }, filePath: null, fileSha256: null, fileSizeBytes: null,
  rowCount: null, attemptCount: 3, cycleAttemptCount: 3, retryCount: 0,
  failureReason: 'PDF_EXPORT_FAILED', queuedAt: '2026-08-09T12:00:00.000Z',
  startedAt: null, completedAt: null, failedAt: '2026-08-09T12:01:00.000Z',
  fileDeletedAt: null, createdAt: '2026-08-09T12:00:00.000Z',
  updatedAt: '2026-08-09T12:01:00.000Z',
};

test('Admin filters, pages, exports, and retries an ERP report', async ({ page }) => {
  let created: unknown;
  let retries = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, { actor: { type: 'admin', accountId: 1 } });
    if (path === '/branches') return json(route, [{ id: 2, name: 'الفرع الرئيسي' }], {
      page: 1, pageSize: 100, total: 1, totalPages: 1,
    });
    if (path === '/reports/erp-sales') {
      const reportPage = Number(url.searchParams.get('page') ?? 1);
      return json(route, {
        reportType: 'erp-sales', title: 'تقرير المبيعات', generatedAt: '2026-08-09T12:00:00.000Z',
        columns: [
          { key: 'invoiceNumber', label: 'رقم الفاتورة' },
          { key: 'clientName', label: 'العميل' },
          { key: 'total', label: 'الإجمالي' },
        ],
        rows: [{
          invoiceNumber: `INV-REPORT-${reportPage}`, clientName: 'عميل تاريخي', total: '230.00',
        }],
        summary: { totalRecords: 21, totalSales: '4830.00' },
      }, { page: reportPage, pageSize: 20, total: 21, totalPages: 2 });
    }
    if (path === '/reports/exports' && request.method() === 'GET') {
      return json(route, [exportRecord], { page: 1, pageSize: 20, total: 1, totalPages: 1 });
    }
    if (path === '/reports/exports' && request.method() === 'POST') {
      created = request.postDataJSON();
      return json(route, { ...exportRecord, id: 10, status: 'queued' });
    }
    if (path === '/reports/exports/9/retry') {
      retries += 1;
      return json(route, { ...exportRecord, status: 'queued', cycleAttemptCount: 0, retryCount: 1 });
    }
    return route.fulfill({ status: 404, headers, body: '{}' });
  });

  await page.goto('/reports');
  await expect(page.getByRole('group', { name: 'أنواع تقارير ERP' }).getByRole('button')).toHaveCount(15);
  await page.getByLabel('الفرع').selectOption('2');
  await page.getByLabel('من تاريخ').fill('2026-08-01');
  await page.getByLabel('إلى تاريخ').fill('2026-08-31');
  await page.getByLabel('بحث').fill('عميل تاريخي');
  await page.getByRole('button', { name: 'تطبيق الفلاتر' }).click();
  await expect(page.getByText('INV-REPORT-1')).toBeVisible();
  await expect(page.getByText('4830.00')).toBeVisible();
  await page.getByRole('button', { name: 'التالي' }).first().click();
  await expect(page.getByText('INV-REPORT-2')).toBeVisible();
  await page.getByRole('button', { name: 'تصدير PDF' }).click();
  await expect.poll(() => created).toMatchObject({
    reportType: 'erp-sales',
    filters: { branchId: 2, dateFrom: '2026-08-01', dateTo: '2026-08-31', search: 'عميل تاريخي' },
    selection: { mode: 'all' },
  });
  await page.getByRole('button', { name: 'إعادة محاولة التصدير' }).click();
  await expect.poll(() => retries).toBe(1);
});

test('Cashier cannot open ERP reports', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/session') return json(route, {
      actor: { type: 'cashier', accountId: 8, employeeId: 17 },
    });
    if (path === '/erp/cashier-sessions/current') return json(route, null);
    return route.fulfill({ status: 404, headers, body: '{}' });
  });

  await page.goto('/reports');
  await expect(page.getByText('هذا القسم مخصص للمدير فقط.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'التقارير' })).toHaveCount(0);
});

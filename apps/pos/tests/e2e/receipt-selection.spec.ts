import { saleFixtures } from '@capella/contracts';
import { expect, test } from '@playwright/test';

for (const role of ['cashier', 'admin'] as const) {
  test(`${role} selects service receipts and the full customer invoice`, async ({ page }, testInfo) => {
    if (testInfo.project.name === 'compact-pos') await page.setViewportSize({ width: 390, height: 844 });
    const invoice = structuredClone(saleFixtures.completedInvoice);
    const base = invoice.lines[0];
    const lines = [2, 5].map((quantity, index) => ({
      ...base, id: 81 + index, sourceId: 21 + index, quantity, name: index ? 'خدمة ثانية' : base.name,
      lineTotal: `${quantity * 200}.00`,
      queueNumbers: Array.from({ length: quantity }, (_, unit) => index * 2 + unit + 1),
      queueAssignments: Array.from({ length: quantity }, (_, unit) => ({
        id: 100 + index * 10 + unit, queueNumber: index * 2 + unit + 1,
        employee: { id: unit % 2 ? 9 : 8, employeeCode: unit % 2 ? 1009 : 1008, name: unit % 2 ? 'منى' : 'سارة' },
      })),
    }));
    let refundReads = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      let data: unknown;
      if (path === '/auth/session') data = { actor: { type: role, accountId: 3, branchId: 2 } };
      else if (path === '/erp/sales/44') data = { ...invoice, lines,
        totals: { ...invoice.totals, subtotal: '1400.00', total: '1385.00' } };
      else if (path === '/erp/cashier-sessions/current') data = null;
      else {
        if (path.startsWith('/erp/sales')) refundReads++;
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
    });
    await page.goto('/invoices/44');
    await expect(page.locator('[data-customer-receipt] tbody').first().getByRole('row')).toHaveCount(2);
    if (role === 'cashier') await expect(page.getByRole('button', { name: 'استرداد', exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      window.print = () => {
        const root = document.querySelector('[data-sale-print-root]')!;
        const slips = [...root.querySelectorAll('[data-service-receipt]')];
        (window as unknown as { printResult: unknown }).printResult = {
          receipts: root.querySelectorAll('[data-receipt]').length,
          customer: root.querySelectorAll('[data-customer-receipt]').length,
          employees: slips.map((slip) => slip.querySelector('[data-assigned-employee]')?.textContent),
          qrCodes: root.querySelectorAll('[data-testid="receipt-qr"] svg').length,
          hiddenApp: [...document.body.children].filter((node) => node !== root)
            .every((node) => getComputedStyle(node).display === 'none'),
          breaks: [...root.querySelectorAll('[data-receipt]')].map((node) => getComputedStyle(node).breakAfter),
        };
      };
    });
    await page.getByRole('button', { name: 'طباعة الإيصال', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'طباعة الإيصال' });
    await expect(dialog.getByRole('checkbox')).toHaveCount(8);
    await page.screenshot({ path: testInfo.outputPath('receipt-selection.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'إلغاء تحديد الكل' }).click();
    await expect(dialog.getByRole('button', { name: 'طباعة المحدد (0)' })).toBeDisabled();
    await dialog.getByRole('checkbox').nth(2).check();
    await dialog.getByRole('checkbox').nth(5).check();
    // Inspect the same print media rules the browser applies during its print dialog.
    await page.emulateMedia({ media: 'print' });
    await page.locator('[role="dialog"] button').filter({ hasText: 'طباعة المحدد (2)' })
      .evaluate((node: HTMLButtonElement) => node.click());
    await expect.poll(() => page.evaluate(() => (window as unknown as { printResult: unknown }).printResult)).toEqual({
      receipts: 2, customer: 0, employees: ['منى', 'سارة'], qrCodes: 2,
      hiddenApp: true, breaks: ['page', 'auto'],
    });
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: 'طباعة الإيصال', exact: true }).click();
    await dialog.getByRole('button', { name: 'تحديد الكل' }).click();
    await dialog.getByRole('button', { name: 'طباعة المحدد (8)' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { printResult: { receipts: number } }).printResult.receipts)).toBe(8);
    await expect(page.locator('[data-service-receipt]')).toHaveCount(0);
    await expect(page.locator('[data-customer-receipt] tbody').first().getByRole('row')).toHaveCount(2);
    if (role === 'cashier') {
      await page.goto('/refunds');
      await expect(page.getByText('هذا القسم مخصص للمدير فقط.')).toBeVisible();
      expect(refundReads).toBe(0);
    }
  });
}

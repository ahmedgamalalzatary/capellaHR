import { saleFixtures } from '@capella/contracts';
import { expect, test } from '@playwright/test';

test('selected receipts retain the original invoice paper margins on an 80 mm roll', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: Math.round(80 * 96 / 25.4), height: 1600 });
  const invoice = structuredClone(saleFixtures.completedInvoice);
  const base = invoice.lines[0];
  const products = ['face mask aloe vera 300 gm', 'face mask blue nila 300gm', 'face mask green clay 300gm',
    'face mask mango & banana gm 300', 'face mask oatmeal gm 300', 'باودر ماسك بنجر 100 gm'];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const data = path === '/auth/session' ? { actor: { type: 'cashier', accountId: 3, branchId: 2 } }
      : path === '/erp/sales/44' ? { ...invoice,
        lines: [base, ...products.map((name, index) => ({ ...base, id: 100 + index,
          itemType: 'product', sourceId: 30 + index, name, quantity: 1,
          unitPrice: index === 5 ? '300.00' : '250.00', lineTotal: index === 5 ? '300.00' : '250.00',
          queueNumbers: [], queueAssignments: [], batches: [{ batchId: 112 + index, quantity: '1.000', expiryDate: null }],
        }))],
        totals: { ...invoice.totals, subtotal: '1750.00', total: '1207.50' },
      } : null;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.goto('/invoices/44');
  await expect(page.locator('[data-customer-receipt]')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const original = await page.locator('[data-customer-receipt]').evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width };
  });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    window.print = () => {
      (window as unknown as { paper: string }).paper = document.querySelector('[data-sale-print-root]')!.outerHTML;
    };
  });
  await page.getByRole('button', { name: 'طباعة الإيصال', exact: true }).click();
  await page.getByRole('button', { name: 'طباعة المحدد (2)' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { paper?: string }).paper))).toBe(true);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', (window as unknown as { paper: string }).paper));
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: testInfo.outputPath('thermal-receipts.png'), fullPage: true });
  const receipts = await page.locator('[data-sale-print-root] [data-receipt]').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    const cells = [...node.querySelectorAll('td, th')].map((cell) => cell.getBoundingClientRect());
    return { left: box.left, right: box.right, width: box.width,
      minCellLeft: Math.min(...cells.map((cell) => cell.left)),
      maxCellRight: Math.max(...cells.map((cell) => cell.right)),
    };
  }));
  expect(receipts).toHaveLength(2);
  for (const receipt of receipts) {
    expect(receipt.width).toBeCloseTo(original.width, 0);
    expect(receipt.left).toBeCloseTo(original.left, 0);
    expect(receipt.right).toBeCloseTo(original.right, 0);
    expect(receipt.minCellLeft).toBeGreaterThanOrEqual(original.left - 1);
    expect(receipt.maxCellRight).toBeLessThanOrEqual(original.right + 1);
  }
});

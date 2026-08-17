import type { ReportSnapshot } from '@capella/contracts';
import { PassThrough, Readable } from 'node:stream';
import { constants, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { renderReportPdf, renderReportPdfToStream } from '../src/index.js';
import { formatCairoTimestamp, formatInvoiceSoldAt, reportSummaryLabel } from '../src/report-pdf.js';

const snapshot: ReportSnapshot = {
  reportType: 'employees',
  title: 'تقرير الموظفين',
  generatedAt: '2026-07-19T08:00:00.000Z',
  columns: [
    { key: 'employeeCode', label: 'كود الموظف' },
    { key: 'fullName', label: 'اسم الموظف' },
    { key: 'branchName', label: 'اسم الفرع' },
  ],
  rows: [
    { employeeCode: 1, fullName: 'أحمد علي', branchName: 'فرع القاهرة' },
    { employeeCode: 2, fullName: 'سارة محمد', branchName: 'فرع الجيزة' },
  ],
  summary: { totalRecords: 2 },
};

/**
 * Reads back the order glyphs are actually painted in, left to right, by
 * decoding the subset font's ToUnicode map. A correct Arabic sheet paints the
 * last word of a line first, because that word sits furthest left.
 */
/** Every inflated content stream that paints text, in page order. */
const pageStreams = (pdf: Buffer): string[] => {
  const source = pdf.toString('latin1');
  const pages: string[] = [];
  for (const match of source.matchAll(/stream\r?\n/gu)) {
    const start = match.index + match[0].length;
    try {
      const text = inflateSync(
        Buffer.from(source.slice(start, source.indexOf('endstream', start)), 'latin1'),
        { finishFlush: constants.Z_SYNC_FLUSH },
      ).toString('latin1');
      if (text.includes('Tj') || text.includes('TJ')) pages.push(text);
    } catch { /* font files and other binary streams are not text */ }
  }
  return pages;
};

const paintedOrder = (pdf: Buffer): string[] => {
  const source = pdf.toString('latin1');
  // Both the page content and the ToUnicode maps are deflated in real output.
  let raw = '';
  let cmaps = '';
  for (const match of source.matchAll(/stream\r?\n/gu)) {
    const start = match.index + match[0].length;
    const end = source.indexOf('endstream', start);
    try {
      const text = inflateSync(
        Buffer.from(source.slice(start, end), 'latin1'),
        { finishFlush: constants.Z_SYNC_FLUSH },
      ).toString('latin1');
      if (text.includes('Tj') || text.includes('TJ')) raw += text;
      if (text.includes('beginbfrange') || text.includes('beginbfchar')) cmaps += text;
    } catch { /* font files and other binary streams are not text */ }
  }
  // One subset per font, so decode against each and keep every reading.
  const maps: Array<Map<number, string>> = [];
  for (const block of cmaps.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    const glyphs = new Map<number, string>();
    for (const line of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>\s*\[([^\]]*)\]/gu)) {
      const first = Number.parseInt(line[1]!, 16);
      [...line[2]!.matchAll(/<([0-9a-fA-F]*)>/gu)].forEach((entry, offset) => {
        const hex = entry[1]!;
        glyphs.set(first + offset, hex ? String.fromCodePoint(Number.parseInt(hex.slice(0, 4), 16)) : '');
      });
    }
    if (glyphs.size) maps.push(glyphs);
  }
  const codes = [...raw.matchAll(/<([0-9a-fA-F]+)>/gu)].flatMap(([, hex]) => {
    const values: number[] = [];
    for (let index = 0; index < hex!.length; index += 4) {
      values.push(Number.parseInt(hex!.slice(index, index + 4), 16));
    }
    return values;
  });
  return maps.map((glyphs) => codes.map((code) => glyphs.get(code) ?? '?').join(''));
};

describe('Arabic report PDF renderer', () => {
  it('paints Arabic words right to left instead of in logical order', async () => {
    const pdf = await renderReportPdf({
      ...snapshot,
      rows: [{ employeeCode: 1, fullName: 'سعيد محمود', branchName: 'فرع القاهرة' }],
    });
    // "سعيد محمود" must reach paper as محمود first: it is the leftmost word.
    const rightToLeft = paintedOrder(pdf).some((painted) => {
      const lastWord = painted.indexOf('دومحم');
      const firstWord = painted.indexOf('ديعس');
      return lastWord >= 0 && firstWord > lastWord;
    });

    expect(rightToLeft).toBe(true);
  });

  it('shapes the page-one footer exactly as every later page', async () => {
    const pdf = await renderReportPdf({
      ...snapshot,
      rows: Array.from({ length: 200 }, (_, index) => ({ fullName: `سعيد محمود ${index}` })),
    });
    // The footer is the first text on each page: same word, same glyphs, so
    // page one is never left carrying a degraded font warm-up run.
    const footers = pageStreams(pdf).map((page) => {
      // The footer is the only text at size 7; page one also carries the warm-up.
      const footer = page.slice(page.indexOf('7 Tf'));
      return [...footer.matchAll(/<([0-9a-fA-F]+)>/gu)].slice(1, 4)
        .map(([, hex]) => hex).join(' ');
    });

    expect(footers.length).toBeGreaterThan(1);
    expect(new Set(footers).size).toBe(1);
  });

  it('formats invoice sale timestamps in Cairo across the UTC midnight boundary', () => {
    expect(formatCairoTimestamp('2026-08-08T22:30:00.000Z')).toBe('09/08/2026، 01:30 ص');
  });

  it('displays an invoice business date without inventing a sale time', () => {
    expect(formatInvoiceSoldAt({ businessDate: '2026-08-09' })).toBe('2026-08-09');
    expect(formatInvoiceSoldAt({
      businessDate: '2026-08-09', soldAt: '2026-08-08T22:30:00.000Z',
    })).toBe('09/08/2026، 01:30 ص');
  });

  it('uses Arabic labels for every ERP report total', () => {
    const keys = [
      'totalRecords', 'totalSales', 'totalDiscount', 'totalTax', 'totalQuantity',
      'totalRevenue', 'totalNetPayments', 'totalNetSales', 'totalCommission',
      'totalRefunds', 'totalVoids', 'totalNetExpenses', 'totalNetPurchases',
      'netQuantityChange', 'totalCost', 'totalProfit',
    ];

    for (const key of keys) {
      expect(reportSummaryLabel(key)).not.toBe(key);
      expect(reportSummaryLabel(key)).toMatch(/[\u0600-\u06ff]/u);
    }
  });

  it('creates a non-empty PDF from an immutable report snapshot', async () => {
    const pdf = await renderReportPdf(snapshot);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(pdf.toString('latin1')).toMatch(/\/FontFile2/);
  });

  it('streams repeatable row batches without buffering the final PDF', async () => {
    const { rows, ...header } = snapshot;
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    let rowSourceCalls = 0;

    await renderReportPdfToStream({
      snapshot: header,
      rows: () => {
        rowSourceCalls += 1;
        return Readable.from([rows]) as AsyncIterable<ReportSnapshot['rows']>;
      },
    }, output);
    const pdf = Buffer.concat(chunks);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(rowSourceCalls).toBe(1);
  });

  it('renders empty reports without dropping their fixed columns or summary', async () => {
    const pdf = await renderReportPdf({ ...snapshot, rows: [], summary: { totalRecords: 0 } });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  it('renders a zero-column snapshot without non-finite table geometry or mutation', async () => {
    const zeroColumnSnapshot: ReportSnapshot = {
      ...snapshot,
      reportType: 'erp-invoice',
      columns: [],
      rows: [{ ignored: 'value' }],
    };
    const original = structuredClone(zeroColumnSnapshot);

    const pdf = await renderReportPdf(zeroColumnSnapshot);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).not.toMatch(/(?:Infinity|NaN)/);
    expect(zeroColumnSnapshot).toEqual(original);
  });

  it('renders ERP invoices as portrait A4 from their immutable line and payment snapshot', async () => {
    const invoice: ReportSnapshot = {
      reportType: 'erp-invoice',
      title: 'فاتورة مبيعات',
      generatedAt: '2026-08-09T12:00:00.000Z',
      columns: [
        { key: 'lineNumber', label: 'البند' },
        { key: 'itemName', label: 'الصنف' },
        { key: 'itemType', label: 'النوع' },
        { key: 'quantity', label: 'الكمية' },
        { key: 'unitPrice', label: 'سعر الوحدة' },
        { key: 'lineTotal', label: 'الإجمالي' },
      ],
      rows: [{
        lineNumber: 1, itemName: 'خدمة تاريخية', itemType: 'خدمة',
        quantity: 1, unitPrice: '200.00', lineTotal: '200.00',
      }],
      summary: {
        invoiceNumber: 'INV-2026.08.09-1', businessDate: '2026-08-09',
        branchName: 'الفرع الرئيسي', clientName: 'عميل محفوظ', clientPhone: '01000000000',
        employeeName: 'موظف محفوظ', authorizedBy: 'admin', payments: 'cash: 190.00',
        subtotal: '200.00', discountAmount: '20.00', taxAmount: '10.00', total: '190.00',
        totalRecords: 1, lineSubtotal: '200.00',
      },
    };
    const original = structuredClone(invoice);

    const pdf = await renderReportPdf(invoice);
    const source = pdf.toString('latin1');

    expect(source).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/);
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(invoice).toEqual(original);
  });

  it('bands wide reports and paginates wrapped rows without mutating the snapshot', async () => {
    const columns = Array.from({ length: 15 }, (_, index) => ({
      key: `column${index}`,
      label: `\u0639\u0645\u0648\u062f ${index + 1}`,
    }));
    const rows = Array.from({ length: 35 }, (_, rowIndex) => Object.fromEntries(
      columns.map((column, columnIndex) => [
        column.key,
        columnIndex === 2
          ? `\u0645\u0648\u0638\u0641 \u0628\u0627\u0633\u0645 \u0639\u0631\u0628\u064a \u0637\u0648\u064a\u0644 ${rowIndex + 1}`
          : rowIndex * 100 + columnIndex,
      ]),
    ));
    const wideSnapshot: ReportSnapshot = { ...snapshot, columns, rows };
    const original = structuredClone(wideSnapshot);

    const pdf = await renderReportPdf(wideSnapshot);
    const pageCount = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

    expect(pageCount).toBeGreaterThan(3);
    expect(wideSnapshot).toEqual(original);
  });

  it('continues a single oversized row across pages instead of clipping it', async () => {
    const columns = [
      { key: 'id', label: '\u0627\u0644\u0631\u0642\u0645' },
      { key: 'code', label: '\u0627\u0644\u0643\u0648\u062f' },
      { key: 'name', label: '\u0627\u0644\u0627\u0633\u0645' },
      { key: 'phone', label: '\u0627\u0644\u0647\u0627\u062a\u0641' },
      { key: 'age', label: '\u0627\u0644\u0639\u0645\u0631' },
      { key: 'branch', label: '\u0627\u0644\u0641\u0631\u0639' },
      { key: 'shift', label: '\u0627\u0644\u0648\u0631\u062f\u064a\u0629' },
      { key: 'address', label: '\u0627\u0644\u0639\u0646\u0648\u0627\u0646' },
    ];
    const pdf = await renderReportPdf({
      ...snapshot,
      reportType: 'erp-invoice',
      columns,
      rows: [{
        id: 1,
        code: 1,
        name: '\u0623\u062d\u0645\u062f',
        phone: '01000000000',
        age: 30,
        branch: '\u0627\u0644\u0642\u0627\u0647\u0631\u0629',
        shift: 600,
        address: '\u0639'.repeat(3_000),
      }],
    });
    const pageCount = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

    expect(pageCount).toBeGreaterThan(2);
  });
});

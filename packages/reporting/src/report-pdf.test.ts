import type { ReportSnapshot } from '@capella/contracts';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { renderReportPdf, renderReportPdfToStream } from './index.js';

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

describe('Arabic report PDF renderer', () => {
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
      columns,
      rows: [{
        id: 1,
        code: 1,
        name: '\u0623\u062d\u0645\u062f',
        phone: '01000000000',
        age: 30,
        branch: '\u0627\u0644\u0642\u0627\u0647\u0631\u0629',
        shift: 600,
        address: '\u0639'.repeat(1_000),
      }],
    });
    const pageCount = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

    expect(pageCount).toBeGreaterThan(1);
  });
});

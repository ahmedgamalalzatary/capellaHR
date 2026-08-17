'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { ReportCell, ReportSnapshot } from '@capella/contracts';

export interface PrintableReport {
  title: string;
  subtitle: string;
  columns: ReportSnapshot['columns'];
  rows: ReportSnapshot['rows'];
  summary: Array<{ label: string; value: ReportCell }>;
}

const cellText = (value: ReportCell) => {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  return String(value);
};

/**
 * The sheet the till prints, mounted beside the app rather than inside it: a
 * report nested in the page is clipped away by the shell's scrolling layout and
 * comes out blank. While it is mounted the app is hidden and only this prints.
 */
export function PrintSheet({ report, onPrinted }: {
  report: PrintableReport;
  onPrinted: () => void;
}) {
  useEffect(() => {
    const { body } = document;
    body.classList.add('printing-report');
    const finish = () => {
      body.classList.remove('printing-report');
      onPrinted();
    };
    window.addEventListener('afterprint', finish, { once: true });
    window.print();
    return () => {
      window.removeEventListener('afterprint', finish);
      body.classList.remove('printing-report');
    };
  }, [onPrinted]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div id="print-root" className="p-0 text-ink">
      <h1 className="mb-1 text-lg font-semibold">{report.title}</h1>
      <p className="mb-4 text-[11px] text-muted">{report.subtitle}</p>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {report.columns.map((column) => (
              <th key={column.key} className="border border-line bg-surface px-2 py-1 text-start font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, index) => (
            <tr key={String(row.id ?? index)} className="break-inside-avoid">
              {report.columns.map((column) => (
                <td key={column.key} className="border border-line px-2 py-1">
                  {cellText(row[column.key] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {report.summary.length ? (
        <ul className="mt-4 flex flex-wrap gap-2 text-[11px]">
          {report.summary.map((entry) => (
            <li key={entry.label} className="border border-line px-3 py-1.5">
              {entry.label}
              <strong className="block text-sm">{cellText(entry.value)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>,
    document.body,
  );
}

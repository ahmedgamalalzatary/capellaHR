import type { ReportCell, ReportColumn, ReportSnapshot } from '@capella/contracts';
import { createRequire } from 'node:module';
import { PassThrough, Readable, type Writable } from 'node:stream';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
type BidiEmbedding = {
  levels: Uint8Array;
  paragraphs: Array<{ start: number; end: number; level: number }>;
};
type Bidi = {
  getEmbeddingLevels(value: string, direction?: 'ltr' | 'rtl'): BidiEmbedding;
  getReorderedIndices(value: string, embedding: BidiEmbedding): number[];
};
const bidiFactory = require('bidi-js') as () => Bidi;
const regularFont = require.resolve(
  '@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf',
);
const boldFont = require.resolve(
  '@expo-google-fonts/noto-sans-arabic/700Bold/NotoSansArabic_700Bold.ttf',
);
const bidi = bidiFactory();

const PAGE_MARGIN = 24;
const FOOTER_HEIGHT = 18;
const MAX_COLUMNS_PER_BAND = 8;
const REPEATED_COLUMNS = 2;
const CELL_PADDING = 4;
const BODY_FONT_SIZE = 7.5;
const BODY_LINE_HEIGHT = 10;
const HEADER_FONT_SIZE = 7.5;
const HEADER_LINE_HEIGHT = 10;

const summaryLabels: Record<string, string> = {
  totalRecords: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0633\u062c\u0644\u0627\u062a',
  activeRecords: '\u0627\u0644\u0633\u062c\u0644\u0627\u062a \u0627\u0644\u0646\u0634\u0637\u0629',
  deletedRecords: '\u0627\u0644\u0633\u062c\u0644\u0627\u062a \u0627\u0644\u0645\u062d\u0630\u0648\u0641\u0629',
  revokedRecords: '\u0627\u0644\u0623\u062c\u0647\u0632\u0629 \u0627\u0644\u0645\u0644\u063a\u0627\u0629',
  averageDurationMinutes: '\u0645\u062a\u0648\u0633\u0637 \u0645\u062f\u0629 \u0627\u0644\u0648\u0631\u062f\u064a\u0629 \u0628\u0627\u0644\u062f\u0642\u0627\u0626\u0642',
  totalRequiredMinutes: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u062f\u0642\u0627\u0626\u0642 \u0627\u0644\u0645\u0639\u0641\u0627\u0629',
  totalAmount: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u0628\u0644\u063a',
};

const display = (value: ReportCell): string => {
  if (value === null) return '\u2014';
  if (typeof value === 'boolean') return value ? '\u0646\u0639\u0645' : '\u0644\u0627';
  return String(value);
};

const cairoTimestamp = (value: string): string => new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
}).format(new Date(value)).replace(/[\u200e\u200f]/g, '');

const hasRtl = (value: string) => /[\u0590-\u08ff]/u.test(value);

/**
 * PDFKit shapes Arabic correctly, but does not place mixed RTL/LTR runs correctly.
 * Keep every directional run in logical order for shaping, while returning the
 * runs in their visual left-to-right order for deterministic placement.
 */
const visualRuns = (value: string): string[] => {
  if (!hasRtl(value) || value.length < 2) return [value];

  const embedding = bidi.getEmbeddingLevels(value, 'rtl');
  const indices = bidi.getReorderedIndices(value, embedding);
  const groups: number[][] = [];
  for (const index of indices) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (current && previous !== undefined && Math.abs(index - previous) === 1) current.push(index);
    else groups.push([index]);
  }

  return groups.map((group) => {
    const start = Math.min(...group);
    const end = Math.max(...group);
    return value.slice(start, end + 1);
  });
};

const textWidth = (document: PDFKit.PDFDocument, value: string): number =>
  visualRuns(value).reduce((total, run) => total + document.widthOfString(run), 0);

const drawText = (
  document: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'center' | 'right' = 'right',
) => {
  const runs = visualRuns(value).map((run) => ({ run, width: document.widthOfString(run) }));
  const measured = runs.reduce((total, run) => total + run.width, 0);
  let cursor = align === 'right' ? x + width - measured : align === 'center' ? x + (width - measured) / 2 : x;

  for (const run of runs) {
    document.save();
    document.text(run.run, cursor, y, { lineBreak: false });
    document.restore();
    cursor += run.width;
  }
};

const splitLongToken = (document: PDFKit.PDFDocument, token: string, width: number): string[] => {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of [...token]) {
    const candidate = `${chunk}${character}`;
    if (chunk && textWidth(document, candidate) > width) {
      chunks.push(chunk);
      chunk = character;
    } else chunk = candidate;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
};

const wrapText = (document: PDFKit.PDFDocument, value: string, width: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/u)) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const wordParts = textWidth(document, word) <= width ? [word] : splitLongToken(document, word, width);
      for (const part of wordParts) {
        const candidate = line ? `${line} ${part}` : part;
        if (line && textWidth(document, candidate) > width) {
          lines.push(line);
          line = part;
        } else line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
};

const columnBands = (columns: ReportColumn[]): ReportColumn[][] => {
  if (columns.length <= MAX_COLUMNS_PER_BAND) return [columns];
  const repeated = columns.slice(0, REPEATED_COLUMNS);
  const remaining = columns.slice(REPEATED_COLUMNS);
  const size = MAX_COLUMNS_PER_BAND - repeated.length;
  const bands: ReportColumn[][] = [];
  for (let index = 0; index < remaining.length; index += size) {
    bands.push([...repeated, ...remaining.slice(index, index + size)]);
  }
  return bands;
};

const drawCellLines = (
  document: PDFKit.PDFDocument,
  lines: string[],
  x: number,
  y: number,
  width: number,
  lineHeight: number,
) => {
  lines.forEach((line, index) => drawText(
    document,
    line,
    x + CELL_PADDING,
    y + CELL_PADDING + index * lineHeight,
    width - CELL_PADDING * 2,
  ));
};

const drawHeader = (
  document: PDFKit.PDFDocument,
  columns: ReportColumn[],
  y: number,
  tableWidth: number,
): number => {
  const width = tableWidth / columns.length;
  document.font('NotoSansArabic-Bold').fontSize(HEADER_FONT_SIZE);
  const lines = columns.map((column) => wrapText(document, column.label, width - CELL_PADDING * 2));
  const height = Math.max(22, Math.max(...lines.map((entry) => entry.length)) * HEADER_LINE_HEIGHT + CELL_PADDING * 2);

  columns.forEach((_, index) => {
    const x = PAGE_MARGIN + index * width;
    document.save().fillColor('#e5e7eb').rect(x, y, width, height).fill().restore();
    document.save().strokeColor('#9ca3af').lineWidth(0.5).rect(x, y, width, height).stroke().restore();
    document.fillColor('#111827');
    drawCellLines(document, lines[index] ?? [''], x, y, width, HEADER_LINE_HEIGHT);
  });
  return y + height;
};

const drawBandHeading = (
  document: PDFKit.PDFDocument,
  snapshot: Omit<ReportSnapshot, 'rows'>,
  bandNumber: number,
  totalBands: number,
  tableWidth: number,
): number => {
  let y = PAGE_MARGIN;
  document.fillColor('#111827').font('NotoSansArabic-Bold').fontSize(17);
  drawText(document, snapshot.title, PAGE_MARGIN, y, tableWidth);
  y += 25;

  document.fillColor('#4b5563').font('NotoSansArabic-Regular').fontSize(8);
  const generated = `\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0625\u0646\u0634\u0627\u0621: ${cairoTimestamp(snapshot.generatedAt)}`;
  drawText(document, generated, PAGE_MARGIN, y, tableWidth);
  y += 17;

  if (totalBands > 1) {
    document.fillColor('#374151').font('NotoSansArabic-Bold').fontSize(8);
    drawText(document, `\u0645\u062c\u0645\u0648\u0639\u0629 \u0627\u0644\u0623\u0639\u0645\u062f\u0629 ${bandNumber}\u00a0\u0645\u0646\u00a0${totalBands}`, PAGE_MARGIN, y, tableWidth);
    y += 17;
  }

  if (bandNumber === 1 && Object.keys(snapshot.summary).length) {
    document.font('NotoSansArabic-Regular').fontSize(8);
    const summary = Object.entries(snapshot.summary)
      .map(([key, value]) => `${summaryLabels[key] ?? key}: ${display(value)}`)
      .join('  |  ');
    const lines = wrapText(document, summary, tableWidth - 12);
    const height = Math.max(26, lines.length * 12 + 12);
    document.save().fillColor('#f9fafb').rect(PAGE_MARGIN, y, tableWidth, height).fill().restore();
    document.save().strokeColor('#d1d5db').lineWidth(0.5).rect(PAGE_MARGIN, y, tableWidth, height).stroke().restore();
    document.fillColor('#111827');
    lines.forEach((line, index) => drawText(document, line, PAGE_MARGIN + 6, y + 6 + index * 12, tableWidth - 12));
    y += height + 10;
  }

  return y;
};

const renderBand = (
  document: PDFKit.PDFDocument,
  snapshot: Omit<ReportSnapshot, 'rows'>,
  columns: ReportColumn[],
  bandNumber: number,
  totalBands: number,
  rows: () => AsyncIterable<ReportSnapshot['rows']>,
  addPage: () => void,
) => {
  const visualColumns = [...columns].reverse();
  const tableWidth = document.page.width - PAGE_MARGIN * 2;
  const bottom = document.page.height - PAGE_MARGIN - FOOTER_HEIGHT;
  let y = drawBandHeading(document, snapshot, bandNumber, totalBands, tableWidth);
  y = drawHeader(document, visualColumns, y, tableWidth);

  const columnWidth = tableWidth / visualColumns.length;
  let rowIndex = 0;
  let hasRows = false;
  const drawRow = (row: ReportSnapshot['rows'][number]) => {
    hasRows = true;
    document.font('NotoSansArabic-Regular').fontSize(BODY_FONT_SIZE);
    const lines = visualColumns.map((column) => wrapText(
      document,
      display(row[column.key] ?? null),
      columnWidth - CELL_PADDING * 2,
    ));
    const rowLineCount = Math.max(...lines.map((entry) => entry.length));
    let lineOffset = 0;

    while (lineOffset < rowLineCount) {
      if (y + 20 > bottom) {
        addPage();
        y = drawHeader(document, visualColumns, PAGE_MARGIN, tableWidth);
      }
      const availableLines = Math.max(
        1,
        Math.floor((bottom - y - CELL_PADDING * 2) / BODY_LINE_HEIGHT),
      );
      const segmentLineCount = Math.min(rowLineCount - lineOffset, availableLines);
      const height = Math.max(20, segmentLineCount * BODY_LINE_HEIGHT + CELL_PADDING * 2);

      visualColumns.forEach((_, columnIndex) => {
        const x = PAGE_MARGIN + columnIndex * columnWidth;
        if (rowIndex % 2) document.save().fillColor('#f9fafb').rect(x, y, columnWidth, height).fill().restore();
        document.save().strokeColor('#9ca3af').lineWidth(0.5).rect(x, y, columnWidth, height).stroke().restore();
        document.fillColor('#111827').font('NotoSansArabic-Regular').fontSize(BODY_FONT_SIZE);
        drawCellLines(
          document,
          (lines[columnIndex] ?? []).slice(lineOffset, lineOffset + segmentLineCount),
          x,
          y,
          columnWidth,
          BODY_LINE_HEIGHT,
        );
      });
      y += height;
      lineOffset += segmentLineCount;
    }
    rowIndex += 1;
  };
  return (async () => {
    for await (const batch of rows()) batch.forEach(drawRow);
    if (hasRows) return;
    const height = 34;
    document.save().strokeColor('#9ca3af').lineWidth(0.5).rect(PAGE_MARGIN, y, tableWidth, height).stroke().restore();
    document.fillColor('#6b7280').font('NotoSansArabic-Regular').fontSize(8);
    drawText(document, '\u0644\u0627 \u062a\u0648\u062c\u062f \u0633\u062c\u0644\u0627\u062a \u0645\u0637\u0627\u0628\u0642\u0629', PAGE_MARGIN, y + 11, tableWidth, 'center');
  })();
};

export type ReportPdfSource = {
  snapshot: Omit<ReportSnapshot, 'rows'>;
  rows: () => AsyncIterable<ReportSnapshot['rows']>;
};

export const renderReportPdfToStream = async (
  source: ReportPdfSource,
  output: Writable,
): Promise<void> => {
  const { snapshot } = source;
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: false,
    compress: true,
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: {
      Title: snapshot.title,
      Author: 'Capella HR',
      Subject: snapshot.title,
    },
  });

  document.registerFont('NotoSansArabic-Regular', regularFont);
  document.registerFont('NotoSansArabic-Bold', boldFont);
  const completed = new Promise<void>((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', reject);
    document.once('error', reject);
  });
  document.pipe(output);
  let pageNumber = 0;
  const addPage = () => {
    document.addPage();
    pageNumber += 1;
    const width = document.page.width - PAGE_MARGIN * 2;
    document.fillColor('#6b7280').font('NotoSansArabic-Regular').fontSize(7);
    drawText(document, `\u0635\u0641\u062d\u0629 ${pageNumber}`, PAGE_MARGIN, document.page.height - PAGE_MARGIN, width, 'center');
  };

  const bands = columnBands(snapshot.columns);
  for (const [index, band] of bands.entries()) {
    addPage();
    if (index === 0) {
      // PDFKit's first shaped run for an embedded Arabic font initializes its
      // subset. Prime both subsets outside the printable area so no real text
      // can become that initialization run.
      document.fillColor('#ffffff').font('NotoSansArabic-Bold').fontSize(1)
        .text('\u0627', -10, -10, { lineBreak: false });
      document.font('NotoSansArabic-Regular').fontSize(1)
        .text('\u0627', -10, -10, { lineBreak: false });
    }
    await renderBand(document, snapshot, band, index + 1, bands.length, source.rows, addPage);
  }
  document.end();
  await completed;
};

export const renderReportPdf = async (snapshot: ReportSnapshot): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  const output = new PassThrough();
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  const { rows, ...header } = snapshot;
  await renderReportPdfToStream({
    snapshot: header,
    rows: () => Readable.from([rows]) as AsyncIterable<ReportSnapshot['rows']>,
  }, output);
  return Buffer.concat(chunks);
};

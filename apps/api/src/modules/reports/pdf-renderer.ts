import { chromium, type Browser } from "playwright";
import type { PdfDocumentDefinition, PdfRenderer } from "./pdf-types";

type BrowserHolder = {
  browser: Browser | null;
  pendingBrowser: Promise<Browser> | null;
};

const browserHolder: BrowserHolder = {
  browser: null,
  pendingBrowser: null
};

export function createPlaywrightPdfRenderer(): PdfRenderer {
  return {
    async render(document) {
      const browser = await getBrowser();
      const page = await browser.newPage();

      try {
        await page.setContent(buildDocumentHtml(document), {
          waitUntil: "load"
        });

        return await page.pdf({
          format: "A4",
          printBackground: true,
          margin: {
            top: "16mm",
            right: "12mm",
            bottom: "16mm",
            left: "12mm"
          }
        });
      } finally {
        await page.close();
      }
    }
  };
}

async function getBrowser() {
  if (browserHolder.browser) {
    return browserHolder.browser;
  }

  if (!browserHolder.pendingBrowser) {
    browserHolder.pendingBrowser = chromium.launch({
      headless: true
    });
  }

  browserHolder.browser = await browserHolder.pendingBrowser;
  browserHolder.pendingBrowser = null;

  return browserHolder.browser;
}

function buildDocumentHtml(document: PdfDocumentDefinition) {
  const headerCells = document.columns
    .map((column) => `<th>${escapeHtml(column)}</th>`)
    .join("");
  const bodyRows = document.rows.length > 0
    ? document.rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("")
    : `<tr><td class="empty" colspan="${document.columns.length}">${escapeHtml(document.emptyMessage)}</td></tr>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Cairo", "Noto Naskh Arabic", "Tahoma", "Arial", sans-serif;
        background: #ffffff;
        color: #111827;
      }

      .page {
        width: 100%;
      }

      .header {
        margin-bottom: 16px;
      }

      h1 {
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 700;
      }

      .subtitle {
        font-size: 12px;
        color: #4b5563;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      th,
      td {
        border: 1px solid #d1d5db;
        padding: 8px 10px;
        text-align: right;
        vertical-align: top;
        font-size: 11px;
        word-break: break-word;
      }

      th {
        background: #f3f4f6;
        font-weight: 700;
      }

      .empty {
        text-align: center;
        color: #6b7280;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <h1>${escapeHtml(document.title)}</h1>
        <div class="subtitle">${escapeHtml(document.subtitle)}</div>
      </header>
      <table>
        <thead>
          <tr>${headerCells}</tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

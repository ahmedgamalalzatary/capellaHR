export type PdfDocumentDefinition = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  emptyMessage: string;
};

export type PdfExportResult = {
  fileName: string;
  content: Buffer;
};

export type PdfRenderer = {
  render(document: PdfDocumentDefinition): Promise<Buffer>;
};

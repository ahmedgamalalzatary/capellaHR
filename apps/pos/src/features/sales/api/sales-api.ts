import type {
  ClientVisitHistoryQuery,
  ClientVisitSummary,
  CompleteSaleInput,
  PublicInvoiceDto,
  InvoiceHistoryItem,
  InvoiceHistoryQuery,
  QuoteSaleInput,
  RefundInvoiceInput,
  RefundQuote,
  RefundQuoteInput,
  ReassignInvoiceLineInput,
  SaleQuote,
  VoidInvoiceInput,
} from '@capella/contracts';

import { api } from '@/lib/api/client';

const queryString = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
};

export const quoteSale = (input: QuoteSaleInput) => (
  api.post<SaleQuote>('/erp/sales/quote', input)
);

export const completeSale = (input: CompleteSaleInput) => (
  api.post<PublicInvoiceDto>('/erp/sales', input)
);

export const listClientVisits = (
  clientId: number,
  query: ClientVisitHistoryQuery,
) => api.getPage<ClientVisitSummary>(
  `/erp/sales/clients/${encodeURIComponent(String(clientId))}/visits${queryString(query)}`,
);

export const listInvoices = (query: InvoiceHistoryQuery) => api.getPage<InvoiceHistoryItem>(
  `/erp/sales${queryString(query)}`,
);

export const getInvoice = (invoiceId: number, branchId?: number) => api.get<PublicInvoiceDto>(
  `/erp/sales/${encodeURIComponent(String(invoiceId))}${queryString({ branchId })}`,
);

export const quoteRefund = (invoiceId: number, input: RefundQuoteInput) => api.post<RefundQuote>(
  `/erp/sales/${encodeURIComponent(String(invoiceId))}/refunds/quote`, input,
);

export const refundInvoice = (invoiceId: number, input: RefundInvoiceInput) => (
  api.post<PublicInvoiceDto>(
    `/erp/sales/${encodeURIComponent(String(invoiceId))}/refunds`, input,
  )
);

export const voidInvoice = (invoiceId: number, input: VoidInvoiceInput) => (
  api.post<PublicInvoiceDto>(
    `/erp/sales/${encodeURIComponent(String(invoiceId))}/void`, input,
  )
);

export const reassignInvoiceLine = (
  invoiceId: number,
  lineId: number,
  input: ReassignInvoiceLineInput,
) => api.post<PublicInvoiceDto>(
  `/erp/sales/invoices/${encodeURIComponent(String(invoiceId))}/lines/${encodeURIComponent(String(lineId))}/reassign`,
  input,
);

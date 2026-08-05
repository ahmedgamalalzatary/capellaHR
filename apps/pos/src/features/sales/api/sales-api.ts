import type {
  ClientVisitHistoryQuery,
  ClientVisitSummary,
  CompleteSaleInput,
  InvoiceDto,
  InvoiceHistoryItem,
  InvoiceHistoryQuery,
  QuoteSaleInput,
  SaleQuote,
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
  api.post<InvoiceDto>('/erp/sales', input)
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

export const getInvoice = (invoiceId: number, branchId?: number) => api.get<InvoiceDto>(
  `/erp/sales/${encodeURIComponent(String(invoiceId))}${queryString({ branchId })}`,
);

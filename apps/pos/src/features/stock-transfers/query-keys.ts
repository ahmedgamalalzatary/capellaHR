export const stockTransferQueryKeys = {
  all: ['erp-stock-transfers'] as const,
  list: (params: object) => ['erp-stock-transfers', 'list', params] as const,
};

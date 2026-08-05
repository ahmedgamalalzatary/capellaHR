export const productQueryKeys = {
  all: ['erp-products'] as const,
  list: (params: object) => ['erp-products', 'list', params] as const,
  movements: (params: object) => ['erp-products', 'movements', params] as const,
};

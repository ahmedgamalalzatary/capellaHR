/** Keeps client lists and lookups under one feature-owned cache root. */
export const clientQueryKeys = {
  all: ['clients'] as const,
  list: <T extends object>(filters: T) => ['clients', 'list', filters] as const,
  byPhone: (phone: string) => ['clients', 'by-phone', phone] as const,
};

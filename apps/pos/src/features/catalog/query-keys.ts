/** Keeps catalog lists and lookups under one feature-owned cache root. */
export const catalogQueryKeys = {
  all: ['catalog'] as const,
  branches: ['catalog', 'branches'] as const,
  employees: (branchId?: number) => ['catalog', 'employees', branchId ?? null] as const,
  categories: <T extends object>(filters: T) => ['catalog', 'categories', filters] as const,
  services: <T extends object>(filters: T) => ['catalog', 'services', filters] as const,
  overrides: (serviceId: number, branchId?: number) =>
    ['catalog', 'overrides', serviceId, branchId ?? null] as const,
};

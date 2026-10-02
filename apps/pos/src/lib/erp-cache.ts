import type { QueryClient } from '@tanstack/react-query';

const roots = {
  batches: ['product-batches'],
  consumables: ['consumables-balances'],
  consumableOptions: ['consumables-balance-options'],
  transferProducts: ['erp-stock-transfers', 'products'],
  catalog: ['catalog'],
  sales: ['erp-sales'],
  clients: ['clients'],
  products: ['erp-products'],
  suppliers: ['erp-suppliers'],
  expenses: ['expenses'],
  commissions: ['erp-commissions'],
  reports: ['erp-reports'],
  bookings: ['erp-bookings'],
  cashierSessions: ['cashier-sessions'],
} as const;

export type ErpMutationEffect =
  | 'catalog'
  | 'client'
  | 'sale'
  | 'reversal'
  | 'purchase'
  | 'expense'
  | 'product'
  | 'commission';

const affected: Record<ErpMutationEffect, ReadonlyArray<keyof typeof roots>> = {
  catalog: ['catalog', 'reports'],
  client: ['clients', 'reports'],
  sale: ['batches', 'consumables', 'consumableOptions', 'transferProducts', 'sales', 'clients', 'products', 'commissions', 'reports', 'bookings', 'cashierSessions'],
  reversal: ['batches', 'consumables', 'consumableOptions', 'transferProducts', 'sales', 'clients', 'products', 'commissions', 'reports', 'cashierSessions'],
  purchase: ['batches', 'consumables', 'consumableOptions', 'transferProducts', 'suppliers', 'products', 'reports'],
  expense: ['expenses', 'reports', 'cashierSessions'],
  product: ['batches', 'consumables', 'consumableOptions', 'transferProducts', 'products', 'reports'],
  commission: ['commissions', 'expenses', 'reports', 'cashierSessions'],
};

export const invalidateErpCaches = (
  queryClient: QueryClient,
  effect: ErpMutationEffect,
  preserveQueryKey?: readonly unknown[],
) => Promise.all(affected[effect].map((domain) => (
  queryClient.invalidateQueries({
    queryKey: roots[domain],
    ...(preserveQueryKey ? {
      predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(preserveQueryKey),
    } : {}),
  })
)));

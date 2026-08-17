import type { QueryClient } from '@tanstack/react-query';

const roots = {
  catalog: ['catalog'],
  sales: ['erp-sales'],
  clients: ['clients'],
  products: ['erp-products'],
  suppliers: ['erp-suppliers'],
  expenses: ['expenses'],
  commissions: ['erp-commissions'],
  reports: ['erp-reports'],
} as const;

export type ErpMutationEffect =
  | 'catalog'
  | 'client'
  | 'sale'
  | 'reversal'
  | 'purchase'
  | 'expense'
  | 'product';

const affected: Record<ErpMutationEffect, ReadonlyArray<keyof typeof roots>> = {
  catalog: ['catalog', 'reports'],
  client: ['clients', 'reports'],
  sale: ['sales', 'clients', 'products', 'commissions', 'reports'],
  reversal: ['sales', 'clients', 'products', 'commissions', 'reports'],
  purchase: ['suppliers', 'products', 'reports'],
  expense: ['expenses', 'reports'],
  product: ['products', 'reports'],
};

export const invalidateErpCaches = (
  queryClient: QueryClient,
  effect: ErpMutationEffect,
) => Promise.all(affected[effect].map((domain) => (
  queryClient.invalidateQueries({ queryKey: roots[domain] })
)));

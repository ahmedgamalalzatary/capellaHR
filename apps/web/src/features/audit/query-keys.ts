/** Keeps all audit history cache reads under one feature-owned root. */
export const auditQueryKeys = {
  all: ['audit'] as const,
  list: (filters: object) => ['audit', 'list', filters] as const,
};

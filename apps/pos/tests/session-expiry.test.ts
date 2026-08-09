import { describe, expect, it } from 'vitest';

import * as providers from '../src/providers';
import { SESSION_QUERY_KEY } from '../src/features/auth';
import { ApiError } from '../src/lib/api/client';

describe('POS session expiry handling', () => {
  it('clears the session and protected caches after any API 401', async () => {
    const createAppQueryClient = Reflect.get(providers, 'createAppQueryClient');
    expect(createAppQueryClient).toBeTypeOf('function');
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, { actor: { type: 'cashier', accountId: 2, employeeId: 7 } });
    queryClient.setQueryData(['sales'], [{ id: 44 }]);

    await expect(queryClient.fetchQuery({
      queryKey: ['protected-request'],
      queryFn: async () => { throw new ApiError(401, { code: 'UNAUTHENTICATED', message: 'expired' }); },
      retry: false,
    })).rejects.toMatchObject({ status: 401 });

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
    expect(queryClient.getQueryData(['sales'])).toBeUndefined();
  });

  it('does not discard a valid session for a wrong-role 403', async () => {
    const createAppQueryClient = Reflect.get(providers, 'createAppQueryClient');
    expect(createAppQueryClient).toBeTypeOf('function');
    const queryClient = createAppQueryClient();
    const session = { actor: { type: 'cashier', accountId: 2, employeeId: 7 } };
    queryClient.setQueryData(SESSION_QUERY_KEY, session);

    await expect(queryClient.fetchQuery({
      queryKey: ['admin-request'],
      queryFn: async () => { throw new ApiError(403, { code: 'FORBIDDEN', message: 'wrong role' }); },
      retry: false,
    })).rejects.toMatchObject({ status: 403 });

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual(session);
  });
});

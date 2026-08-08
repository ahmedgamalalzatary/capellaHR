import { describe, expect, test } from 'vitest';

import { SESSION_QUERY_KEY } from '../src/features/auth';
import { ApiError } from '../src/lib/api/client';
import { createAppQueryClient } from '../src/providers';

const unauthenticated = () => new ApiError(401, {
  code: 'UNAUTHENTICATED',
  message: 'يجب تسجيل الدخول',
});

const failWith = (queryClient: ReturnType<typeof createAppQueryClient>, error: ApiError) => (
  queryClient.fetchQuery({
    queryKey: ['employees'],
    queryFn: () => Promise.reject(error),
    retry: false,
  }).catch(() => undefined)
);

describe('global unauthenticated handling', () => {
  test('drops the cached session when any request is rejected as unauthenticated', async () => {
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, { actor: { type: 'admin' } });

    await failWith(queryClient, unauthenticated());

    // Route guards read this entry; nulling it is what sends the admin back to /login
    // instead of leaving a signed-in shell whose every panel shows a load error.
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });

  test('keeps the cached session when a request fails for any other reason', async () => {
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, { actor: { type: 'admin' } });

    await failWith(queryClient, new ApiError(500, { code: 'INTERNAL_ERROR', message: 'حدث خطأ داخلي' }));

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ actor: { type: 'admin' } });
  });

  test('drops the cached session when a mutation is rejected as unauthenticated', async () => {
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, { actor: { type: 'admin' } });

    // Submitting a form is exactly when a session is most likely to be found dead, and it
    // must sign the user out the same way a failed read does.
    await queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(unauthenticated()),
      retry: false,
    }).execute(undefined).catch(() => undefined);

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });

  test('keeps the cached session when the server is unreachable', async () => {
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, { actor: { type: 'admin' } });

    await failWith(queryClient, new ApiError(0, { code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم.' }));

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({ actor: { type: 'admin' } });
  });
});

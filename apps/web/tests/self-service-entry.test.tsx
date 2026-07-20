import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_QUERY_KEY } from '../src/features/auth/hooks/use-session';
import { SelfServiceEntry } from '../src/features/employee-self-service/components/self-service-entry';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const renderEntry = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}><SelfServiceEntry /></QueryClientProvider>),
    queryClient,
  };
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SelfServiceEntry', () => {
  it('renders the own-record view for an employee session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/session')) return response({ data: { actor: { type: 'employee' } } });
      if (url.endsWith('/self-service/overview')) return response({ data: {
        profile: { employeeCode: 42, fullName: 'Ahmed Gamal', personalPhone: '01012345678', whatsappPhone: '01112345678', age: 31, address: 'Cairo' },
        branch: { name: 'Main', location: 'Cairo' }, shift: { durationMinutes: 480 },
        baseSalary: { amount: '5000.00', currency: 'EGP' },
      } });
      throw new Error(`Unexpected request: ${url}`);
    }));

    renderEntry();

    expect(await screen.findByText('Ahmed Gamal')).toBeDefined();
    expect(screen.getByRole('tablist')).toBeDefined();
  });

  it('shows the employee login form when there is no active session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' },
    }, 401)));

    renderEntry();

    await waitFor(() => expect(document.getElementById('employeeCode')).not.toBeNull());
    expect(document.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('does not render employee records for an admin session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { actor: { type: 'admin' } } })));

    renderEntry();

    expect(await screen.findByRole('heading')).toBeDefined();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('exits self-service and clears cached employee data when an own-data request returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/session')) return response({ data: { actor: { type: 'employee' } } });
      if (url.endsWith('/self-service/overview')) return response({
        error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' },
      }, 401);
      throw new Error(`Unexpected request: ${url}`);
    }));

    const { queryClient } = renderEntry();
    queryClient.setQueryData(['self-service', 'previously-loaded'], { secret: 'cached' });

    await waitFor(() => expect(document.getElementById('employeeCode')).not.toBeNull());
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['self-service'] })).toHaveLength(0);
  });
});

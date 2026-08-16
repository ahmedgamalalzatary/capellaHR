import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn());
vi.mock('../src/features/clients/api/clients-api', () => ({
  createClient,
  updateClient: vi.fn(),
}));

import { ClientForm } from '../src/features/clients/components/client-form';

const mount = (defaultPhone?: string) => render(
  <QueryClientProvider client={new QueryClient()}>
    <ClientForm branchId={1} {...(defaultPhone === undefined ? {} : { defaultPhone })} />
  </QueryClientProvider>,
);

describe('client form draft', () => {
  beforeEach(() => { sessionStorage.clear(); createClient.mockReset(); });
  afterEach(cleanup);

  it('offers back a client the counter started entering', () => {
    mount();
    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'ندى سمير' } });
    cleanup();

    mount();

    fireEvent.click(screen.getByRole('button', { name: 'استعادة' }));
    expect((screen.getByLabelText(/^اسم العميل/) as HTMLInputElement).value).toBe('ندى سمير');
  });

  /** The picker pre-fills the number the cashier typed there, which is not an edit. */
  it('keeps offering the draft when the form opens pre-filled from a sale', () => {
    mount();
    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'ندى سمير' } });
    cleanup();

    mount('01012345678');

    expect(screen.getByRole('button', { name: 'استعادة' })).toBeDefined();
    expect(JSON.parse(sessionStorage.getItem('capella:form-draft:client:1')!).fullName)
      .toBe('ندى سمير');
  });
});

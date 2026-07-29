import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProtectedAreaGate } from '../src/features/protected-area/components/protected-area-gate';

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProtectedAreaGate', () => {
  it('unlocks only the requested area for the current browser tab', async () => {
    vi.mocked(fetch).mockReturnValue(response({ unlocked: true }));

    const { rerender } = render(
      <ProtectedAreaGate area="employees">
        <p>employee content</p>
      </ProtectedAreaGate>,
    );

    expect(screen.queryByText('employee content')).toBeNull();
    fireEvent.change(screen.getByLabelText('كلمة مرور الوصول'), {
      target: { value: 'Cap2255' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'فتح القسم' }));

    expect(await screen.findByText('employee content')).toBeDefined();
    expect(sessionStorage.getItem('capella:protected-area:employees')).toBe('unlocked');
    expect(sessionStorage.getItem('capella:protected-area:reports')).toBeNull();

    rerender(
      <ProtectedAreaGate area="reports">
        <p>reports content</p>
      </ProtectedAreaGate>,
    );
    expect(screen.queryByText('reports content')).toBeNull();
  });

  it('keeps the area locked and shows an Arabic error for a wrong password', async () => {
    vi.mocked(fetch).mockReturnValue(response({ error: 'INVALID_PASSWORD' }, 401));

    render(
      <ProtectedAreaGate area="payroll">
        <p>payroll content</p>
      </ProtectedAreaGate>,
    );

    fireEvent.change(screen.getByLabelText('كلمة مرور الوصول'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'فتح القسم' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'كلمة المرور غير صحيحة.',
    );
    expect(screen.queryByText('payroll content')).toBeNull();
    expect(sessionStorage.getItem('capella:protected-area:payroll')).toBeNull();
  });

  it('restores access after refresh in the same tab without checking again', async () => {
    sessionStorage.setItem('capella:protected-area:reports', 'unlocked');

    render(
      <ProtectedAreaGate area="reports">
        <p>reports content</p>
      </ProtectedAreaGate>,
    );

    expect(await screen.findByText('reports content')).toBeDefined();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  current: {
    data: undefined as { actor: { type: string } } | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../src/features/auth', () => ({
  useSession: () => session.current,
}));

import { ErpHomeView } from '../src/components/shell/erp-home-view';

afterEach(() => {
  cleanup();
  session.current = { ...session.current, data: undefined };
});

describe('ErpHomeView', () => {
  it('offers the fixed assets register from the admin dashboard', () => {
    session.current = { ...session.current, data: { actor: { type: 'admin' } } };
    render(<ErpHomeView />);

    expect(screen.getByRole('link', { name: 'الأصول الثابتة' }).getAttribute('href')).toBe('/fixed-assets');
  });

  it('keeps the workspace hidden while the actor is unresolved', () => {
    render(<ErpHomeView />);

    expect(screen.getByRole('status', { name: 'جارٍ التحقق من الجلسة…' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'لوحة الإدارة' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'وردية الكاشير' })).toBeNull();
  });
});

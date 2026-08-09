import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  current: {
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../src/features/auth', () => ({
  useSession: () => session.current,
}));

import { ErpHomeView } from '../src/components/shell/erp-home-view';

afterEach(cleanup);

describe('ErpHomeView', () => {
  it('keeps the workspace hidden while the actor is unresolved', () => {
    render(<ErpHomeView />);

    expect(screen.getByRole('status', { name: 'جارٍ التحقق من الجلسة…' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'لوحة الإدارة' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'وردية الكاشير' })).toBeNull();
  });
});

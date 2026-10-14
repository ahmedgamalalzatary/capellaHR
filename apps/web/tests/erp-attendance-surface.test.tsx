import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect, usePathname: () => '/attendance' }));

import AdminLayout from '../src/app/(admin)/layout';
import SelfServicePage from '../src/app/(employee)/self-service/page';
import LoginPage from '../src/app/login/page';
import { Sidebar } from '../src/components/shell/sidebar';

beforeEach(() => {
  redirect.mockClear();
  vi.stubEnv('EDITION', 'erp');
  vi.stubEnv('NEXT_PUBLIC_CAPELLA_EDITION', 'erp');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('ERP attendance-only web surface', () => {
  it('keeps admin login and attendance-support administration available', () => {
    AdminLayout({ children: <p>admin</p> });
    LoginPage();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects employee self-service to the branch attendance kiosk', () => {
    SelfServicePage();
    expect(redirect).toHaveBeenCalledWith('/branch-kiosk');
  });

  it('shows only core and attendance-support navigation', () => {
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'الحضور والغياب' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'الموظفون' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'الرواتب' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'التقارير' })).toBeNull();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect, usePathname: () => '/attendance' }));

import AdminLayout from '../src/app/(admin)/layout';
import SelfServicePage from '../src/app/(employee)/self-service/page';
import LoginPage from '../src/app/login/page';
import { visibleAdminNav } from '../src/components/shell/nav';

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
    const labels = visibleAdminNav().flatMap((group) => group.items.map((item) => item.label));

    expect(labels).toContain('الحضور والغياب');
    expect(labels).toContain('الموظفون');
    expect(labels).not.toContain('الرواتب');
    expect(labels).not.toContain('التقارير');
  });
});

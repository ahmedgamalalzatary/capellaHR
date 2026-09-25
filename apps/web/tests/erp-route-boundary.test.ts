import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { proxy } from '../src/proxy';

afterEach(() => vi.unstubAllEnvs());

describe('ERP Web route boundary', () => {
  it('redirects every HR-only route to attendance', () => {
    vi.stubEnv('EDITION', 'erp');
    for (const pathname of [
      '/dashboard',
      '/weekly-day-off',
      '/payroll/2026-08',
      '/bonuses',
      '/deductions',
      '/advances',
      '/reports',
      '/self-service',
    ]) {
      const response = proxy(new NextRequest(`https://attendance.example.com${pathname}`));

      expect(response.status, pathname).toBe(307);
      expect(response.headers.get('location'), pathname)
        .toBe('https://attendance.example.com/branch-kiosk');
    }
  });

  it.each(['/attendance', '/employees', '/devices', '/shifts', '/branches'])(
    'allows the attendance-support route %s',
    (pathname) => {
      vi.stubEnv('EDITION', 'erp');
      expect(proxy(new NextRequest(`https://attendance.example.com${pathname}`)).status).toBe(200);
    },
  );

  it('does not restrict the full HR surface', () => {
    vi.stubEnv('EDITION', 'full');
    expect(proxy(new NextRequest('https://hr.example.com/payroll')).status).toBe(200);
  });
});

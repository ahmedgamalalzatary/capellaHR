import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { middleware } from '../src/middleware';

afterEach(() => vi.unstubAllEnvs());

describe('ERP Web route boundary', () => {
  it.each(['/dashboard', '/payroll/2026-08', '/reports', '/self-service'])(
    'redirects the HR-only route %s to attendance',
    (pathname) => {
      vi.stubEnv('EDITION', 'erp');
      const response = middleware(new NextRequest(`https://attendance.example.com${pathname}`));

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://attendance.example.com/branch-kiosk');
    },
  );

  it.each(['/attendance', '/employees', '/devices', '/shifts', '/branches'])(
    'allows the attendance-support route %s',
    (pathname) => {
      vi.stubEnv('EDITION', 'erp');
      expect(middleware(new NextRequest(`https://attendance.example.com${pathname}`)).status).toBe(200);
    },
  );

  it('does not restrict the full HR surface', () => {
    vi.stubEnv('EDITION', 'full');
    expect(middleware(new NextRequest('https://hr.example.com/payroll')).status).toBe(200);
  });
});

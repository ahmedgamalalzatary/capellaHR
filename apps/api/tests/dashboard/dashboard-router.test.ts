import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import type { DashboardSnapshotDto } from '@capella/contracts';

const makeAuth = (actorType: 'admin' | 'employee' | null = 'admin') => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    actorType,
    employeeId: actorType === 'employee' ? 7 : null,
  }),
}) as unknown as AuthService;

const snapshot: DashboardSnapshotDto = {
  generatedAt: '2026-07-20T09:00:00.000Z',
  cairoDate: '2026-07-20',
  payrollMonth: '2026-06',
  currentlyCheckedIn: { total: 0, items: [] },
  previousDayOpen: { total: 0, items: [] },
  notCheckedIn: { total: 0, items: [] },
  latestDailyRecords: { items: [] },
  attendanceReview: { unresolvedTotal: 0, flaggedTotal: 0, items: [] },
  automaticTimeouts: { total: 0, items: [] },
  devicePairings: { pendingTotal: 0, replacementTotal: 0, items: [] },
  payrollBlockers: { total: 0, items: [] },
  pdfExports: { queued: 0, processing: 0, completed: 0, failed: 0, items: [] },
};

const service = { getSnapshot: vi.fn(async () => snapshot) };

const app = (actorType: 'admin' | 'employee' | null, dashboardService = service) => createApp({
  authService: makeAuth(actorType),
  dashboardService,
});

describe('dashboard HTTP API', () => {
  it('serves one admin-only operational snapshot from the application composition', async () => {
    const response = await request(app('admin')).get('/api/v1/dashboard')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      cairoDate: '2026-07-20',
      payrollMonth: '2026-06',
      currentlyCheckedIn: { total: 0 },
      pdfExports: { failed: 0 },
    });
    expect(service.getSnapshot).toHaveBeenCalledTimes(1);

    expect((await request(app(null)).get('/api/v1/dashboard')).status).toBe(401);
    expect((await request(app('employee')).get('/api/v1/dashboard')
      .set('Cookie', 'capella_session=x')).status).toBe(403);
  });

  it('forwards unexpected snapshot failures to the application error middleware', async () => {
    const broken = { getSnapshot: vi.fn(async () => { throw new Error('database unavailable'); }) };
    const response = await request(app('admin', broken)).get('/api/v1/dashboard')
      .set('Cookie', 'capella_session=x')
      .set('x-request-id', 'dashboard-error');

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_ERROR', requestId: 'dashboard-error',
    });
    expect(JSON.stringify(response.body)).not.toContain('database unavailable');
  });
});

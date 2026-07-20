import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import * as auditModule from '../../src/modules/audit/index.js';
import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import { errorHandler, requestContext } from '../../src/shared/http/index.js';

const auth = (actorType: 'admin' | 'employee' | null = 'admin') => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    id: 'session', tokenHash: 'hash', actorType,
    employeeId: actorType === 'employee' ? 7 : null, revokedAt: null,
  }),
}) as unknown as Pick<AuthService, 'authenticate'>;

const service = () => ({
  list: vi.fn(async () => ({
    items: [{
      id: 1,
      actorType: 'admin' as const,
      actorIdentifier: 'admin',
      module: 'payroll',
      action: 'finalize',
      entityType: 'payroll',
      entityId: '42',
      beforeState: null,
      afterState: { status: 'finalized' },
      relatedIds: { employeeId: '7' },
      requestId: 'request-42',
      ipAddress: '127.0.0.1',
      userAgent: 'Vitest',
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    }],
    total: 1,
  })),
});

const app = (actorType: 'admin' | 'employee' | null, auditService = service()) => {
  const createAuditRouter = Reflect.get(auditModule, 'createAuditRouter');
  expect(createAuditRouter).toBeTypeOf('function');
  const result = express();
  result.use(requestContext);
  result.use('/api/v1/audit', createAuditRouter(auditService, auth(actorType)));
  result.use(errorHandler);
  return result;
};

describe('audit router', () => {
  it('mounts the audit module in the application composition', async () => {
    const response = await request(createApp({
      authService: auth('admin') as AuthService,
      auditService: service(),
    })).get('/api/v1/audit').set('Cookie', 'capella_session=token');
    expect(response.status).toBe(200);
  });

  it('returns immutable history with combined filters and pagination', async () => {
    const auditService = service();
    const response = await request(app('admin', auditService))
      .get('/api/v1/audit')
      .query({
        search: 'payroll', actorType: 'admin', module: 'payroll', action: 'finalize',
        entityType: 'payroll', entityId: '42', requestId: 'request-42',
        dateFrom: '2026-07-01', dateTo: '2026-07-20', page: 2, pageSize: 10,
      });

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      id: 1, module: 'payroll', action: 'finalize', createdAt: '2026-07-20T10:00:00.000Z',
    });
    expect(response.body.meta).toEqual({ page: 2, pageSize: 10, total: 1, totalPages: 1 });
    expect(auditService.list).toHaveBeenCalledWith({
      search: 'payroll', actorType: 'admin', module: 'payroll', action: 'finalize',
      entityType: 'payroll', entityId: '42', requestId: 'request-42',
      dateFrom: '2026-07-01', dateTo: '2026-07-20', page: 2, pageSize: 10,
    });
  });

  it('forbids employee access', async () => {
    expect((await request(app('employee')).get('/api/v1/audit')).status).toBe(403);
  });

  it('returns a structured validation error and forwards unexpected failures', async () => {
    const invalid = await request(app('admin')).get('/api/v1/audit?dateFrom=2026-07-21&dateTo=2026-07-20');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) });

    const broken = service();
    broken.list.mockRejectedValueOnce(new Error('database unavailable'));
    const unexpected = await request(app('admin', broken)).get('/api/v1/audit');
    expect(unexpected.status).toBe(500);
    expect(unexpected.body.error).toMatchObject({ code: 'INTERNAL_ERROR', requestId: expect.any(String) });
    expect(JSON.stringify(unexpected.body)).not.toContain('database unavailable');
  });
});

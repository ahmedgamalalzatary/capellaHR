import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import * as auditModule from '../../src/modules/audit/index.js';
import { createAuthMiddleware } from '../../src/modules/auth/index.js';
import { requestContext } from '../../src/shared/http/index.js';

describe('audit writer', () => {
  it('redacts secrets recursively before persistence', () => {
    expect(auditModule).toHaveProperty('redactAuditValue');
    const redact = auditModule.redactAuditValue;

    expect(redact({
      fullName: 'أحمد',
      pin: '1234',
      nested: {
        passwordHash: 'hash',
        credentialId: 'credential',
        token: 'token',
        authorization: 'Bearer secret-token',
        apiKey: 'secret-api-key',
        ordinary: ['kept'],
      },
    })).toEqual({
      fullName: 'أحمد',
      pin: '[REDACTED]',
      nested: {
        passwordHash: '[REDACTED]',
        credentialId: '[REDACTED]',
        token: '[REDACTED]',
        authorization: '[REDACTED]',
        apiKey: '[REDACTED]',
        ordinary: ['kept'],
      },
    });
  });

  it('redacts cyclic arrays without recursing forever', () => {
    const cyclic: unknown[] = ['kept'];
    cyclic.push(cyclic);

    expect(auditModule.redactAuditValue(cyclic)).toEqual(['kept', '[REDACTED]']);
  });

  it('writes request, actor, network, entity, and related metadata together', async () => {
    expect(auditModule).toHaveProperty('runWithAuditContext');
    expect(auditModule).toHaveProperty('writeAudit');
    const values = vi.fn(async () => undefined);
    const executor: auditModule.AuditExecutor = { insert: vi.fn(() => ({ values })) };
    const run = auditModule.runWithAuditContext;
    const write = auditModule.writeAudit;

    await run({
      actorType: 'employee',
      actorIdentifier: '17',
      requestId: 'request-17',
      ipAddress: '127.0.0.1',
      userAgent: 'Vitest',
    }, () => write(executor, {
      module: 'employees',
      action: 'update',
      entityType: 'employee',
      entityId: 17,
      beforeState: { fullName: 'قبل' },
      afterState: { fullName: 'بعد', pinHash: 'secret' },
      relatedIds: { branchId: 3 },
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    }));

    expect(values).toHaveBeenCalledWith({
      actorType: 'employee',
      actorIdentifier: '17',
      module: 'employees',
      action: 'update',
      entityType: 'employee',
      entityId: '17',
      beforeState: { fullName: 'قبل' },
      afterState: { fullName: 'بعد', pinHash: '[REDACTED]' },
      relatedIds: { branchId: '3' },
      requestId: 'request-17',
      ipAddress: '127.0.0.1',
      userAgent: 'Vitest',
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    });
  });

  it('uses an explicit event actor over the ambient system context', async () => {
    const values = vi.fn(async () => undefined);
    const executor: auditModule.AuditExecutor = { insert: vi.fn(() => ({ values })) };
    const write = auditModule.writeAudit;

    await write(executor, {
      actor: { type: 'admin', identifier: 'admin@example.test' },
      module: 'auth', action: 'login_failed', entityType: 'session', entityId: 'admin@example.test',
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'admin',
      actorIdentifier: 'admin@example.test',
    }));
  });

  it('propagates request and authenticated actor context through Express', async () => {
    const values = vi.fn(async () => undefined);
    const executor = { insert: vi.fn(() => ({ values })) };
    const auth = createAuthMiddleware({
      authenticate: vi.fn(async () => ({
        id: 'session', tokenHash: 'hash', actorType: 'employee' as const,
        employeeId: 17, revokedAt: null,
      })),
    });
    const app = express();
    app.use(requestContext);
    app.post('/mutate', auth.authenticate, async (_request, response) => {
      await auditModule.writeAudit(executor, {
        module: 'employees', action: 'update', entityType: 'employee', entityId: 17,
      });
      response.status(204).end();
    });

    await request(app)
      .post('/mutate')
      .set('Cookie', 'capella_session=valid-token')
      .set('x-request-id', 'request-17')
      .set('user-agent', 'Audit Browser')
      .expect(204);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'employee',
      actorIdentifier: '17',
      requestId: 'request-17',
      ipAddress: expect.any(String),
      userAgent: 'Audit Browser',
    }));
  });
});

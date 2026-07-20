import { createDatabase } from '@capella/database';
import { auditEvents } from '@capella/database/schema';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  createAuditModule,
  runWithAuditContext,
  writeAudit,
} from '../../src/modules/audit/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const module = createAuditModule(database, { timeZone: 'Africa/Cairo' });

beforeEach(async () => {
  await database.delete(auditEvents);
});

describe('MySQL-backed audit history', () => {
  it('persists redacted immutable context and searches combined filters', async () => {
    await runWithAuditContext({
      actorType: 'admin', actorIdentifier: 'admin', requestId: 'request-payroll',
      ipAddress: '127.0.0.1', userAgent: 'Vitest',
    }, () => database.transaction(async (transaction) => {
      await writeAudit(transaction, {
        module: 'payroll', action: 'finalize', entityType: 'payroll', entityId: 42,
        afterState: { status: 'finalized', pinHash: 'must-not-survive' },
        relatedIds: { employeeId: 7 },
        createdAt: new Date('2026-07-19T22:30:00.000Z'),
      });
    }));

    const result = await module.service.list({
      search: 'payroll', actorType: 'admin', module: 'payroll', action: 'finalize',
      entityType: 'payroll', entityId: '42', requestId: 'request-payroll',
      dateFrom: '2026-07-20', dateTo: '2026-07-20', page: 1, pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      actorType: 'admin', actorIdentifier: 'admin', requestId: 'request-payroll',
      ipAddress: '127.0.0.1', userAgent: 'Vitest',
      module: 'payroll', action: 'finalize', entityType: 'payroll', entityId: '42',
      afterState: { status: 'finalized', pinHash: '[REDACTED]' },
      relatedIds: { employeeId: '7' },
    });
  });

  it('rolls an audit entry back with its enclosing business transaction', async () => {
    await expect(database.transaction(async (transaction) => {
      await writeAudit(transaction, {
        module: 'branches', action: 'create', entityType: 'branch', entityId: 1,
      });
      throw new Error('roll back business operation');
    })).rejects.toThrow('roll back business operation');

    expect((await module.service.list({ page: 1, pageSize: 20 })).total).toBe(0);
  });
});

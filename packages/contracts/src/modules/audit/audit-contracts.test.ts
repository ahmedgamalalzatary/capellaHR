import { describe, expect, it } from 'vitest';

import * as auditContracts from './index.js';

describe('audit contracts', () => {
  it('exposes a paginated combined audit filter contract', () => {
    expect(auditContracts).toHaveProperty('listAuditEventsQuerySchema');

    const schema = Reflect.get(auditContracts, 'listAuditEventsQuerySchema') as {
      parse(input: unknown): Record<string, unknown>;
    };
    expect(schema.parse({
      search: '  payroll  ',
      actorType: 'admin',
      module: 'payroll',
      action: 'finalize',
      entityType: 'payroll',
      entityId: '42',
      requestId: 'request-42',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-20',
    })).toEqual({
      search: 'payroll',
      actorType: 'admin',
      module: 'payroll',
      action: 'finalize',
      entityType: 'payroll',
      entityId: '42',
      requestId: 'request-42',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-20',
      page: 1,
      pageSize: 20,
    });
  });

  it('rejects an inverted audit date range and unknown actors', () => {
    const schema = Reflect.get(auditContracts, 'listAuditEventsQuerySchema') as {
      safeParse(input: unknown): { success: boolean };
    };
    expect(schema.safeParse({ dateFrom: '2026-07-21', dateTo: '2026-07-20' }).success).toBe(false);
    expect(schema.safeParse({ actorType: 'anonymous' }).success).toBe(false);
  });
});

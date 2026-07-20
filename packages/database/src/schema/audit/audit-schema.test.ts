import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import * as auditSchema from './index.js';

describe('audit schema', () => {
  it('defines permanent append-only audit metadata storage', () => {
    expect(auditSchema).toHaveProperty('auditEvents');
    const table = Reflect.get(auditSchema, 'auditEvents') as Parameters<typeof getTableConfig>[0];
    const config = getTableConfig(table);

    expect(config.name).toBe('audit_events');
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'id',
      'actor_type',
      'actor_identifier',
      'action',
      'module',
      'entity_type',
      'entity_id',
      'before_state',
      'after_state',
      'related_ids',
      'request_id',
      'ip_address',
      'user_agent',
      'created_at',
    ]));
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'audit_events_created_idx',
      'audit_events_module_action_idx',
      'audit_events_entity_idx',
      'audit_events_request_idx',
    ]));
  });
});

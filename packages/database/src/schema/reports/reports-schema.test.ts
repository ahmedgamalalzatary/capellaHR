import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { reportExports } from './index.js';

describe('reports schema', () => {
  it('stores the durable immutable PDF export lifecycle without deleting metadata', () => {
    const table = getTableConfig(reportExports);
    expect(table.name).toBe('report_exports');
    expect(table.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'report_type',
      'status',
      'filters',
      'selection',
      'file_path',
      'file_sha256',
      'row_count',
      'attempt_count',
      'cycle_attempt_count',
      'retry_count',
      'queued_at',
      'started_at',
      'completed_at',
      'failed_at',
      'file_deleted_at',
    ]));
    expect(table.indexes.some((index) => index.config.name === 'report_exports_status_queue_idx')).toBe(true);
    expect(table.checks.some((check) => check.name === 'report_exports_attempt_count_nonnegative')).toBe(true);
    expect(table.checks.some((check) => check.name === 'report_exports_cycle_attempt_count_bounded')).toBe(true);
  });
});

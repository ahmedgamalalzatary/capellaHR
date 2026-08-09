import type { ReportReader } from '@capella/api/reports-runtime';
import type { createDatabase } from '@capella/database';
import { describe, expect, it, vi } from 'vitest';

import { createWorkerReportRuntime } from '../src/worker-runtime.js';

describe('ERP report worker runtime', () => {
  it('dispatches ERP reports through the reader supplied to the side-effect-free factory', async () => {
    const read = vi.fn<ReportReader['read']>().mockResolvedValue({ kind: 'unavailable' });
    const erpReader = { read, readBatches: vi.fn() } satisfies ReportReader;
    const runtime = createWorkerReportRuntime({
      database: {} as ReturnType<typeof createDatabase>,
      erpReader,
      filesRoot: '.',
      timeZone: 'Africa/Cairo',
    });

    await runtime.reports.reader.read(
      'erp-sales', { branchId: 2 }, { mode: 'all' },
      { page: 1, pageSize: 20 }, new Date('2026-08-09T12:00:00.000Z'),
    );

    expect(read).toHaveBeenCalledOnce();
  });
});

import type { ReportReader } from '@capella/api/reports-runtime';
import { resolveEdition } from '@capella/config/edition';
import type { createDatabase } from '@capella/database';
import { describe, expect, it, vi } from 'vitest';

import { createWorkerEditionPlan, createWorkerReportRuntime } from '../src/worker-runtime.js';

describe('ERP report worker runtime', () => {
  it('derives worker capabilities from the shared edition registry', () => {
    expect(createWorkerEditionPlan(resolveEdition('hr'))).toEqual({
      attendance: true,
      payroll: true,
      reports: true,
      erpReports: false,
      erpSales: false,
    });
    expect(createWorkerEditionPlan(resolveEdition('erp'))).toEqual({
      attendance: true,
      payroll: false,
      reports: true,
      erpReports: true,
      erpSales: true,
    });
    expect(createWorkerEditionPlan(resolveEdition('full'))).toEqual({
      attendance: true,
      payroll: true,
      reports: true,
      erpReports: true,
      erpSales: true,
    });
    expect(createWorkerEditionPlan(resolveEdition(undefined))).toEqual({
      attendance: false,
      payroll: false,
      reports: false,
      erpReports: false,
      erpSales: false,
    });
  });

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

  it('constructs an HR-only report runtime without an ERP reader', async () => {
    const runtime = createWorkerReportRuntime({
      database: {} as ReturnType<typeof createDatabase>,
      filesRoot: '.',
      timeZone: 'Africa/Cairo',
    });

    await expect(runtime.reports.reader.read(
      'erp-sales', { branchId: 2 }, { mode: 'all' },
      { page: 1, pageSize: 20 }, new Date('2026-08-09T12:00:00.000Z'),
    )).resolves.toEqual({ kind: 'unavailable' });
  });
});

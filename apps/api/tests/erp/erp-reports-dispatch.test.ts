import type { ReportReader } from '../../src/modules/reports/index.js';
import { createDrizzleReportReader, createReportsModule } from '../../src/modules/reports/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const generatedAt = new Date('2026-08-09T12:00:00.000Z');
const result = {
  kind: 'success' as const,
  total: 1,
  snapshot: {
    reportType: 'erp-sales' as const,
    title: 'تقرير المبيعات',
    generatedAt: generatedAt.toISOString(),
    columns: [{ key: 'invoiceNumber', label: 'رقم الفاتورة' }],
    rows: [{ invoiceNumber: 'INV.2026.08.09.0001' }],
    summary: { totalRecords: 1 },
  },
};

describe('ERP report dispatch', () => {
  it('delegates ERP report views and batches without making HR read ERP tables', async () => {
    const read = vi.fn().mockResolvedValue(result);
    const readBatches = vi.fn().mockResolvedValue({
      kind: 'success', snapshot: { ...result.snapshot, rows: undefined }, total: 1, rowCount: 1,
    });
    const erp: ReportReader = {
      read,
      readBatches,
    };
    const transaction = vi.fn();
    const reader = createDrizzleReportReader({ transaction } as never, { erp });

    await expect(reader.read(
      'erp-sales', { branchId: 2 }, { mode: 'all' }, { page: 1, pageSize: 20 }, generatedAt,
    )).resolves.toEqual(result);
    await reader.readBatches(
      'erp-sales', { branchId: 2 }, { mode: 'all' }, 500, generatedAt, async () => {},
    );

    expect(read).toHaveBeenCalledOnce();
    expect(readBatches).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('fails closed when the ERP report capability is absent', async () => {
    const transaction = vi.fn();
    const reader = createDrizzleReportReader({ transaction } as never);

    await expect(reader.read(
      'erp-sales', {}, { mode: 'all' }, { page: 1, pageSize: 20 }, generatedAt,
    )).resolves.toEqual({ kind: 'unavailable' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('passes the ERP reader through the shared report module composition', async () => {
    const read = vi.fn().mockResolvedValue(result);
    const erp: ReportReader = {
      read,
      readBatches: vi.fn(),
    };
    const module = createReportsModule({} as never, { erp, filesRoot: 'unused' });

    await expect(module.reader.read(
      'erp-sales', {}, { mode: 'all' }, { page: 1, pageSize: 20 }, generatedAt,
    )).resolves.toEqual(result);
    expect(read).toHaveBeenCalledOnce();
  });

  it('injects the ERP reader into the API report runtime', () => {
    const server = readFileSync(fileURLToPath(new URL('../../src/server.ts', import.meta.url)), 'utf8');
    expect(server).toContain('createErpReportsModule');
    expect(server).toContain('erp: erpReportsModule.reader');
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  createErpReportsModule,
  createErpReportReader,
  type ErpReportRepository,
} from '../../src/modules/erp/erp-reports/index.js';

const generatedAt = new Date('2026-08-09T12:00:00.000Z');

describe('ERP report reader', () => {
  it('composes the MySQL repository and public reader capability', () => {
    const module = createErpReportsModule({ transaction: vi.fn() } as never);
    expect(typeof module.repository.readPage).toBe('function');
    expect(typeof module.repository.readBatches).toBe('function');
    expect(typeof module.reader.read).toBe('function');
  });

  it('returns fixed Arabic metadata, full-filter totals, and a bounded page', async () => {
    const readPage = vi.fn().mockResolvedValue({
        rows: [{ id: 7, invoiceNumber: 'INV.2026.08.09.0001', total: '125.00' }],
        total: 3,
        summary: { totalRecords: 3, totalSales: '375.00' },
      });
    const repository: ErpReportRepository = {
      readPage,
      readBatches: vi.fn(),
    };
    const reader = createErpReportReader(repository);

    const result = await reader.read(
      'erp-sales',
      { branchId: 2, dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      { mode: 'all' },
      { page: 2, pageSize: 1 },
      generatedAt,
    );

    expect(readPage).toHaveBeenCalledWith(
      'erp-sales',
      { branchId: 2, dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      { mode: 'all' },
      { page: 2, pageSize: 1 },
    );
    expect(result).toMatchObject({
      kind: 'success',
      total: 3,
      snapshot: {
        title: 'تقرير المبيعات',
        generatedAt: generatedAt.toISOString(),
        rows: [{ id: 7, invoiceNumber: 'INV.2026.08.09.0001', total: '125.00' }],
        summary: { totalRecords: 3, totalSales: '375.00' },
      },
    });
  });

  it('streams every filtered row in deterministic batches without buffering the export', async () => {
    const implementation: ErpReportRepository['readBatches'] = async (
      _type, _filters, _selection, _size, onBatch,
    ) => {
      await onBatch([{ id: 1 }, { id: 2 }]);
      await onBatch([{ id: 3 }]);
      return { total: 3, rowCount: 3, summary: { totalRecords: 3 } };
    };
    const readBatches = vi.fn(implementation);
    const reader = createErpReportReader({ readPage: vi.fn(), readBatches });
    const batches: unknown[] = [];

    const result = await reader.readBatches(
      'erp-expenses', {}, { mode: 'all' }, 2, generatedAt,
      async (rows) => { batches.push(rows); },
    );

    expect(readBatches).toHaveBeenCalledTimes(1);
    expect(batches).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);
    expect(result).toMatchObject({ kind: 'success', total: 3, rowCount: 3 });
  });

  it.each([
    ['erp-service-queue', 'تقرير أرقام أدوار الخدمات', [
      ['id', 'المعرف'], ['eventDate', 'وقت الإصدار'], ['branchName', 'الفرع'], ['shiftId', 'الوردية'],
      ['serviceName', 'الخدمة'], ['queueNumber', 'رقم الدور'], ['invoiceNumber', 'رقم الفاتورة'],
      ['clientName', 'العميل'], ['employeeName', 'الموظف'], ['authorizedBy', 'الكاشير'],
      ['status', 'الحالة'], ['completedAt', 'وقت الإنهاء'],
    ]],
    ['erp-service-completions', 'تقارير إنهاء الخدمات', [
      ['id', 'المعرف'], ['eventDate', 'وقت الإنهاء'], ['branchName', 'الفرع'], ['shiftId', 'الوردية'],
      ['serviceName', 'الخدمة'], ['queueNumber', 'رقم الدور'], ['invoiceNumber', 'رقم الفاتورة'],
      ['clientName', 'العميل'], ['employeeName', 'الموظف'], ['completionKind', 'النتيجة'],
      ['consumables', 'المستهلكات'], ['totalCost', 'التكلفة'],
    ]],
    ['erp-consumable-usage', 'استخدام المستهلكات', [
      ['id', 'المعرف'], ['eventDate', 'الوقت'], ['branchName', 'الفرع'], ['productName', 'المستهلك'],
      ['unit', 'الوحدة'], ['serviceName', 'الخدمة'], ['employeeName', 'الموظف'],
      ['quantity', 'الكمية'], ['cost', 'التكلفة'],
    ]],
    ['erp-consumable-ledger', 'سجل مخزون المستهلكات', [
      ['id', 'المعرف'], ['eventDate', 'الوقت'], ['branchName', 'الفرع'], ['productName', 'المستهلك'],
      ['unit', 'الوحدة'], ['entryType', 'الحركة'], ['quantityDelta', 'التغيير'],
      ['balanceAfter', 'الرصيد'], ['unitCost', 'تكلفة الوحدة'], ['totalCost', 'التكلفة'],
      ['actingUsername', 'المنفذ'], ['note', 'ملاحظة'],
    ]],
    ['erp-service-exceptions', 'الخدمات المتأخرة', [
      ['id', 'المعرف'], ['eventDate', 'وقت البيع'], ['branchName', 'الفرع'], ['shiftId', 'الوردية'],
      ['serviceName', 'الخدمة'], ['queueNumber', 'رقم الدور'], ['invoiceNumber', 'رقم الفاتورة'],
      ['clientName', 'العميل'], ['employeeName', 'الموظف'],
    ]],
  ] as const)('publishes exact %s metadata for report consumers', async (reportType, title, columns) => {
    const repository: ErpReportRepository = {
      readPage: vi.fn().mockResolvedValue({ rows: [], total: 0, summary: { totalRecords: 0 } }),
      readBatches: vi.fn(),
    };
    const result = await createErpReportReader(repository).read(
      reportType, {}, { mode: 'all' }, { page: 1, pageSize: 20 }, generatedAt,
    );
    expect(result).toMatchObject({
      kind: 'success',
      snapshot: {
        title,
        columns: columns.map(([key, label]) => ({ key, label })),
      },
    });
  });
});

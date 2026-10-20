import type { CommissionListQuery } from '@capella/contracts';

import type { ErpAccountIdentity, ReportExcelRenderer } from '../hr-capabilities.js';
import type { CommissionService } from './commission-service.js';

/** Use the monthly screen's source so payouts and later reversals agree with it. */
export const renderCommissionExcel = async (
  service: CommissionService,
  actor: ErpAccountIdentity,
  filters: Pick<CommissionListQuery, 'month' | 'branchId' | 'employeeId'>,
  renderExcel: ReportExcelRenderer,
) => {
  const query = { ...filters, page: 1, pageSize: 100 };
  // Resolve branch permissions before starting workbook generation.
  const first = await service.list(actor, query);
  return renderExcel({
    snapshot: {
      reportType: 'erp-commissions',
      title: `العمولات — ${filters.month}`,
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'employeeCode', label: 'الكود' },
        { key: 'employeeName', label: 'الموظف' },
        { key: 'earnedAmount', label: 'مكتسبة' },
        { key: 'reversedAmount', label: 'معكوسة' },
        { key: 'netAmount', label: 'الصافي' },
        { key: 'paidAmount', label: 'مدفوع (كل الفروع)' },
        { key: 'availableAmount', label: 'المتاح (كل الفروع)' },
        { key: 'counts', label: 'البنود / العكس' },
      ],
      summary: { totalRecords: first.total },
    },
    rows: async function* () {
      let result = first;
      const pages = Math.ceil(first.total / query.pageSize);
      for (let page = 1; page <= Math.max(1, pages); page += 1) {
        if (page > 1) result = await service.list(actor, { ...query, page });
        yield result.items.map((item) => ({
          employeeCode: item.employeeCode,
          employeeName: item.employeeName,
          earnedAmount: item.earnedAmount,
          reversedAmount: item.reversedAmount,
          netAmount: item.netAmount,
          paidAmount: item.paidAmount,
          availableAmount: item.availableAmount,
          counts: `${item.serviceUnitCount ?? item.invoiceLineCount} / ${item.reversalCount}`,
        }));
      }
    },
  });
};

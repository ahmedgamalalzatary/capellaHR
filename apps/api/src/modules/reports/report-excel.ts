import type { ReportSnapshot } from '@capella/contracts';
import ExcelJS from 'exceljs';
import { Writable } from 'node:stream';

const summaryLabels: Record<string, string> = {
  totalRecords: 'إجمالي السجلات', activeRecords: 'سجلات نشطة',
  deletedRecords: 'سجلات محذوفة', revokedRecords: 'سجلات ملغاة',
  averageDurationMinutes: 'متوسط مدة الوردية بالدقائق',
  totalRequiredMinutes: 'إجمالي الدقائق المطلوبة', totalAmount: 'إجمالي المبلغ (ج.م)',
  attendanceRecords: 'سجلات الحضور', absenceRecords: 'سجلات الغياب',
  weeklyDayOffRecords: 'أيام الراحة الأسبوعية', totalWorkedMinutes: 'إجمالي دقائق العمل',
  totalOvertimeMinutes: 'إجمالي الدقائق الإضافية', totalShortageMinutes: 'إجمالي دقائق النقص',
  openRecords: 'رواتب مفتوحة', finalizedRecords: 'رواتب معتمدة',
  totalNetSalary: 'إجمالي صافي الرواتب (ج.م)',
  totalSales: 'إجمالي المبيعات', totalDiscount: 'إجمالي الخصومات', totalTax: 'إجمالي الضرائب',
  totalQuantity: 'صافي الكمية', totalRevenue: 'صافي الإيراد',
  totalNetPayments: 'صافي المدفوعات', totalNetSales: 'صافي المبيعات',
  totalCommission: 'صافي العمولات', totalRefunds: 'إجمالي المرتجعات', totalVoids: 'إجمالي الإلغاءات',
  totalNetExpenses: 'صافي المصروفات', totalNetPurchases: 'صافي المشتريات',
  netQuantityChange: 'صافي تغير المخزون', totalCost: 'إجمالي التكلفة', totalProfit: 'إجمالي الربح',
  totalServices: 'إجمالي الخدمات', totalProducts: 'إجمالي المنتجات',
  totalServiceSales: 'صافي مبيعات الخدمات', totalProductSales: 'صافي مبيعات المنتجات',
  totalNetCashPayments: 'صافي المدفوع نقدي', totalNetVisaPayments: 'صافي المدفوع فيزا',
  totalNetInstapayPayments: 'صافي المدفوع إنستا باي',
  totalNetVodafoneCashPayments: 'صافي المدفوع فودافون كاش',
  totalMadeServices: 'إجمالي الخدمات المنفذة', totalRefundedServices: 'إجمالي الخدمات المرتجعة',
  totalSoldProducts: 'إجمالي المنتجات المباعة', totalRefundedProducts: 'إجمالي المنتجات المرتجعة',
  totalAvailableQuantity: 'إجمالي الكمية المتاحة', totalInventoryValue: 'إجمالي قيمة المخزون',
  totalTransferCost: 'إجمالي تكلفة التحويلات', totalBalanceDue: 'إجمالي الأرصدة المستحقة',
  expiredBatches: 'دفعات منتهية', expiringSoonBatches: 'تنتهي خلال 30 يوماً',
  unknownExpiryBatches: 'دفعات غير محددة الصلاحية',
};

/** Commit rows as they are read so only the compressed download stays in memory. */
export const renderReportExcel = async (source: {
  snapshot: Omit<ReportSnapshot, 'rows'>;
  rows: () => AsyncIterable<ReportSnapshot['rows']>;
}): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) { chunks.push(chunk); done(); },
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
  workbook.title = source.snapshot.title;
  workbook.created = new Date(source.snapshot.generatedAt);
  let sheetIndex = 0;
  const addSheet = () => {
    sheetIndex += 1;
    const sheet = workbook.addWorksheet(`التقرير ${sheetIndex}`, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = source.snapshot.columns.map(({ label }) => ({ header: label, width: 24 }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();
    return sheet;
  };
  let sheet = addSheet();
  let rowCount = 1;
  for await (const batch of source.rows()) {
    for (const row of batch) {
      // Excel limits each sheet to 1,048,576 rows, including its header.
      if (rowCount === 1_048_576) {
        sheet.commit();
        sheet = addSheet();
        rowCount = 1;
      }
      sheet.addRow(source.snapshot.columns.map(({ key }) => row[key] ?? null)).commit();
      rowCount += 1;
    }
  }
  sheet.commit();
  const summary = workbook.addWorksheet('الملخص', { views: [{ rightToLeft: true }] });
  summary.columns = [{ header: 'البند', width: 40 }, { header: 'القيمة', width: 24 }];
  summary.getRow(1).font = { bold: true };
  summary.getRow(1).commit();
  for (const [key, value] of Object.entries(source.snapshot.summary)) {
    summary.addRow([summaryLabels[key] ?? key, value]).commit();
  }
  summary.commit();
  await workbook.commit();
  return Buffer.concat(chunks);
};

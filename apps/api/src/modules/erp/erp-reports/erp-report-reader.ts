import {
  erpReportTypes,
  type ReportCell,
  type ReportColumn,
  type ReportFilters,
  type ReportSelection,
  type ReportSnapshot,
  type ReportType,
} from '@capella/contracts';

import type { ReportReader } from '../hr-capabilities.js';

export type ErpReportType = (typeof erpReportTypes)[number];
export type ErpReportPagination = {
  page: number;
  pageSize: number;
  purpose?: 'screen' | 'availability';
} | null;
export type ErpReportPage = {
  rows: Array<Record<string, ReportCell>>;
  total: number;
  summary: Record<string, ReportCell>;
};

export interface ErpReportRepository {
  readPage(
    reportType: ErpReportType,
    filters: ReportFilters,
    selection: ReportSelection,
    pagination: ErpReportPagination,
  ): Promise<ErpReportPage>;
  readBatches(
    reportType: ErpReportType,
    filters: ReportFilters,
    selection: ReportSelection,
    batchSize: number,
    onBatch: (rows: ErpReportPage['rows']) => Promise<void>,
  ): Promise<{ total: number; rowCount: number; summary: ErpReportPage['summary'] }>;
}

const metadata: Record<ErpReportType, { title: string; columns: ReportColumn[] }> = {
  'erp-sales': {
    title: 'تقرير المبيعات',
    columns: [
      ['id', 'المعرف'], ['invoiceNumber', 'رقم الفاتورة'], ['businessDate', 'تاريخ البيع'],
      ['branchName', 'الفرع'], ['clientName', 'العميل'], ['clientPhone', 'الهاتف'],
      ['employeeName', 'الموظف'], ['authorizedBy', 'المصرح'], ['saleKind', 'النوع'],
      ['subtotal', 'قبل الخصم والضريبة'],
      ['discountAmount', 'الخصم'], ['taxAmount', 'الضريبة'], ['total', 'الإجمالي'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-payment-methods': {
    title: 'تقرير طرق الدفع',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['eventType', 'نوع الحركة'],
      ['paymentMethod', 'طريقة الدفع'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-services': {
    title: 'تقرير الخدمات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['serviceName', 'الخدمة'], ['employeeName', 'الموظف'],
      ['eventType', 'نوع الحركة'], ['quantity', 'الكمية'], ['unitPrice', 'سعر الوحدة'],
      ['amount', 'الإيراد'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-products': {
    title: 'تقرير المنتجات المباعة',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['productName', 'المنتج'], ['eventType', 'نوع الحركة'],
      ['quantity', 'الكمية'], ['unitPrice', 'سعر الوحدة'], ['costBasis', 'تكلفة الوحدة'],
      ['amount', 'الإيراد'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-employees': {
    title: 'تقرير مبيعات الموظفين',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['employeeCode', 'كود الموظف'],
      ['employeeName', 'الموظف'], ['eventType', 'نوع الحركة'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-commissions': {
    title: 'تقرير العمولات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['employeeName', 'الموظف'], ['serviceName', 'الخدمة'],
      ['eventType', 'نوع الحركة'], ['commissionRate', 'النسبة'], ['baseAmount', 'أساس العمولة'],
      ['amount', 'العمولة'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-discounts': {
    title: 'تقرير الخصومات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['eventType', 'نوع الحركة'],
      ['adjustmentKind', 'نوع الخصم'], ['adjustmentValue', 'قيمة الخصم'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-taxes': {
    title: 'تقرير الضرائب',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['eventType', 'نوع الحركة'],
      ['adjustmentKind', 'نوع الضريبة'], ['adjustmentValue', 'قيمة الضريبة'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-refunds': {
    title: 'تقرير المرتجعات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['clientName', 'العميل'], ['reason', 'السبب'],
      ['authorizedBy', 'المنفذ'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-voids': {
    title: 'تقرير الإلغاءات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['clientName', 'العميل'], ['reason', 'السبب'],
      ['authorizedBy', 'المنفذ'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-expenses': {
    title: 'تقرير المصروفات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['expenseName', 'المصروف'], ['description', 'الوصف'], ['eventType', 'نوع الحركة'],
      ['authorizedBy', 'المنفذ'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-purchases': {
    title: 'تقرير المشتريات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['supplierName', 'المورد'], ['eventType', 'نوع الحركة'], ['status', 'الحالة'],
      ['authorizedBy', 'المنفذ'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-stock': {
    title: 'تقرير حركة المخزون',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['productName', 'المنتج'], ['reason', 'السبب'], ['quantityDelta', 'تغير الكمية'],
      ['balanceAfter', 'الرصيد بعد الحركة'], ['authorizedBy', 'المنفذ'], ['note', 'ملاحظة'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-profit': {
    title: 'تقرير أرباح المنتجات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['productName', 'المنتج'], ['eventType', 'نوع الحركة'],
      ['quantity', 'الكمية'], ['revenue', 'الإيراد'], ['cost', 'التكلفة'], ['profit', 'الربح'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-client-history': {
    title: 'تقرير سجل العملاء',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'التاريخ'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['clientName', 'العميل'], ['clientPhone', 'الهاتف'],
      ['eventType', 'نوع الحركة'], ['employeeName', 'الموظف'], ['amount', 'المبلغ'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-receivables': {
    title: 'تقرير أرصدة العملاء',
    columns: [
      ['id', 'المعرف'], ['soldAt', 'تاريخ البيع'], ['branchName', 'الفرع'],
      ['invoiceNumber', 'رقم الفاتورة'], ['clientName', 'العميل'], ['clientPhone', 'الهاتف'],
      ['originalTotal', 'قيمة الفاتورة'], ['amountPaid', 'صافي المدفوع'],
      ['creditedAmount', 'رصيد المرتجعات'], ['balanceDue', 'المستحق'], ['ageDays', 'العمر بالأيام'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-service-queue': {
    title: 'تقرير أرقام أدوار الخدمات',
    columns: [
      ['id', 'المعرف'], ['eventDate', 'وقت الإصدار'], ['branchName', 'الفرع'],
      ['shiftId', 'الوردية'], ['serviceName', 'الخدمة'], ['queueNumber', 'رقم الدور'],
      ['invoiceNumber', 'رقم الفاتورة'], ['clientName', 'العميل'],
      ['employeeName', 'الموظف'], ['authorizedBy', 'الكاشير'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
  'erp-invoice': {
    title: 'فاتورة مبيعات',
    columns: [
      ['id', 'المعرف'], ['lineNumber', 'البند'], ['itemName', 'الصنف'], ['itemType', 'النوع'],
      ['quantity', 'الكمية'], ['unitPrice', 'سعر الوحدة'], ['lineTotal', 'الإجمالي'],
    ].map(([key, label]) => ({ key: key!, label: label! })),
  },
};

const isErpReportType = (value: ReportType): value is ErpReportType => (
  (erpReportTypes as readonly ReportType[]).includes(value)
);

const snapshot = (
  reportType: ErpReportType,
  page: ErpReportPage,
  generatedAt: Date,
): ReportSnapshot => ({
  reportType,
  title: metadata[reportType].title,
  generatedAt: generatedAt.toISOString(),
  columns: metadata[reportType].columns,
  rows: page.rows,
  summary: page.summary,
});

export const createErpReportReader = (repository: ErpReportRepository): ReportReader => ({
  async read(reportType, filters, selection, pagination, generatedAt) {
    if (!isErpReportType(reportType)) return { kind: 'unavailable' };
    const page = await repository.readPage(reportType, filters, selection, pagination);
    return { kind: 'success', snapshot: snapshot(reportType, page, generatedAt), total: page.total };
  },

  async readBatches(reportType, filters, selection, batchSize, generatedAt, onBatch) {
    if (!isErpReportType(reportType)) return { kind: 'unavailable' };
    const result = await repository.readBatches(
      reportType, filters, selection, batchSize, onBatch,
    );
    const header = snapshot(reportType, { rows: [], ...result }, generatedAt);
    const snapshotHeader = {
      reportType: header.reportType,
      title: header.title,
      generatedAt: header.generatedAt,
      columns: header.columns,
      summary: header.summary,
    };
    return {
      kind: 'success',
      snapshot: snapshotHeader,
      total: result.total,
      rowCount: result.rowCount,
    };
  },
});

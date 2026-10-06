import type { ReportCell } from '@capella/contracts';

import type { ErpReportType } from './erp-report-reader.js';
import type { RawRow } from './erp-report-sql.js';

const normalizeCell = (value: unknown): ReportCell => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER)
    && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  return JSON.stringify(value) ?? '';
};

const eventLabels: Record<string, string> = {
  sale: 'بيع', refund: 'استرداد', void: 'إلغاء', earned: 'مستحقة', reversal: 'عكس',
  expense: 'مصروف', purchase: 'شراء', purchase_cancellation: 'إلغاء شراء',
  booking_payment: 'دفع مقدم حجز', booking_refund: 'رد مقدم حجز',
};
const paymentLabels: Record<string, string> = {
  cash: 'نقدي', visa: 'فيزا', instapay: 'إنستا باي', vodafone_cash: 'فودافون كاش',
  booking_credit: 'مدفوع من المقدم',
};
const stockReasonLabels: Record<string, string> = {
  transfer_in: 'تحويل وارد', consumable_reserve: 'حجز مستهلك', consumable_return: 'إرجاع مستهلك',
  opening_stock: 'رصيد افتتاحي', count_correction: 'تصحيح جرد', wastage: 'هالك',
  damage: 'تالف', sale: 'بيع', purchase: 'شراء', purchase_cancellation: 'إلغاء شراء',
  refund: 'استرداد', void: 'إلغاء',
};
const purchaseStatusLabels: Record<string, string> = {
  posted: 'مرحّلة', cancelled: 'ملغاة',
};

const serviceStatusLabels: Record<string, string> = {
  pending: 'لم تبدأ', in_progress: 'قيد التنفيذ', completed: 'مكتملة', overdue: 'متأخرة',
};
const bookingStatusLabels: Record<string, string> = {
  booked: 'محجوز', arrived: 'حضر', converted: 'تم البيع', cancelled: 'ملغي', no_show: 'لم يحضر',
};
const completionKindLabels: Record<string, string> = {
  consumables: 'بمستهلكات', none: 'بدون مستهلكات', unrecorded: 'لم تسجل المستهلكات',
};
const consumableEntryLabels: Record<string, string> = {
  reserve: 'تحويل إلى المستهلكات', return: 'إرجاع إلى مخزون البيع', consume: 'استهلاك خدمة',
  correction_restore: 'استرجاع تصحيح', correction_consume: 'استهلاك تصحيح',
};

export const localizeErpReportRow = (
  reportType: ErpReportType,
  row: RawRow,
): Record<string, ReportCell> => Object.fromEntries(
  Object.entries(row).map(([key, raw]) => {
    const value = normalizeCell(raw);
    if ((key === 'stockHistory' || key === 'consumableHistory') && typeof value === 'string') {
      const labels = key === 'stockHistory' ? stockReasonLabels : consumableEntryLabels;
      return [key, value.replace(/\b[a-z_]+\b/g, (word) => labels[word] ?? word)];
    }
    // The invoice snapshot lists its payments as "method: amount | …".
    if (reportType === 'erp-invoice' && key === 'payments' && typeof value === 'string') {
      return [key, value.replace(/\b[a-z_]+\b/g, (word) => paymentLabels[word] ?? word)];
    }
    if (key === 'expiryStatus' && typeof value === 'string') return [key,
      ({ expired: 'منتهية', soon: 'تنتهي خلال 30 يوماً', unknown: 'غير محددة', valid: 'سارية' } as Record<string, string>)[value] ?? value];
    if (key === 'rowType' && typeof value === 'string') {
      return [key, value === 'combined' ? 'مجمع' : 'فردي'];
    }
    if (key === 'eventType' && typeof value === 'string') return [key, eventLabels[value] ?? value];
    if (reportType === 'erp-expenses' && key === 'expenseName' && value === 'advance') {
      return [key, 'سلفة'];
    }
    if (key === 'paymentMethod' && typeof value === 'string') return [key, paymentLabels[value] ?? value];
    if (key === 'adjustmentKind' && typeof value === 'string') {
      return [key, value === 'percentage' ? 'نسبة مئوية' : 'قيمة ثابتة'];
    }
    if (key === 'itemType' && typeof value === 'string') return [key, value === 'service' ? 'خدمة' : 'منتج'];
    if (reportType === 'erp-stock' && key === 'reason' && typeof value === 'string' && stockReasonLabels[value]) {
      return [key, stockReasonLabels[value]];
    }
    if (reportType === 'erp-purchases' && key === 'status' && typeof value === 'string') {
      return [key, purchaseStatusLabels[value] ?? value];
    }
    if ((reportType === 'erp-service-queue' || reportType === 'erp-service-completions'
      || reportType === 'erp-service-exceptions') && key === 'status' && typeof value === 'string') {
      return [key, serviceStatusLabels[value] ?? value];
    }
    if (reportType === 'erp-bookings' && key === 'status' && typeof value === 'string') {
      return [key, bookingStatusLabels[value] ?? value];
    }
    if (reportType === 'erp-service-completions' && key === 'completionKind' && typeof value === 'string') {
      return [key, completionKindLabels[value] ?? value];
    }
    if (reportType === 'erp-consumable-ledger' && key === 'entryType' && typeof value === 'string') {
      return [key, consumableEntryLabels[value] ?? value];
    }
    return [key, value];
  }),
);

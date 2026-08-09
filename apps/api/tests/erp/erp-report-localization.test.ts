import { describe, expect, it } from 'vitest';

import { localizeErpReportRow } from '../../src/modules/erp/erp-reports/erp-report-repository.js';

describe('ERP report row localization', () => {
  it('localizes stock reasons without rewriting reversal free text', () => {
    expect(localizeErpReportRow('erp-stock', { reason: 'damage' })).toEqual({ reason: 'تالف' });
    expect(localizeErpReportRow('erp-refunds', { reason: 'damage' })).toEqual({ reason: 'damage' });
    expect(localizeErpReportRow('erp-voids', { reason: 'refund' })).toEqual({ reason: 'refund' });
  });

  it('localizes posted and cancelled purchase statuses', () => {
    expect(localizeErpReportRow('erp-purchases', { status: 'posted' })).toEqual({ status: 'مرحّلة' });
    expect(localizeErpReportRow('erp-purchases', { status: 'cancelled' })).toEqual({ status: 'ملغاة' });
  });
});

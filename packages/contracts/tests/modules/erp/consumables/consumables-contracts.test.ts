import { describe, expect, it } from 'vitest';

import {
  configureConsumableSchema,
  correctServiceExecutionSchema,
  listConsumableServicesQuerySchema,
  recordServiceConsumptionsSchema,
  transferConsumableStockSchema,
  updateServiceExecutionStatusSchema,
} from '../../../../src/modules/erp/consumables/index.js';

describe('ERP consumables contracts', () => {
  it('records consumables independently with explicit confirmation when none were used', () => {
    expect(recordServiceConsumptionsSchema.safeParse({ serviceQueueEntryIds: [11], usages: [] }).success).toBe(false);
    expect(recordServiceConsumptionsSchema.safeParse({ serviceQueueEntryIds: [11], usages: [], noConsumablesConfirmed: true }).success).toBe(true);
    expect(recordServiceConsumptionsSchema.safeParse({
      serviceQueueEntryIds: [11], usages: [{ productId: 7, quantity: '15' }], noConsumablesConfirmed: true,
    }).success).toBe(false);
  });

  it('updates service progress without requiring consumables', () => {
    expect(updateServiceExecutionStatusSchema.parse({
      serviceQueueEntryIds: [11, 12], status: 'completed',
    })).toEqual({ serviceQueueEntryIds: [11, 12], status: 'completed' });
    expect(updateServiceExecutionStatusSchema.safeParse({
      serviceQueueEntryIds: [11], status: 'canceled',
    }).success).toBe(false);
  });

  it('supports the combined unfinished customer-service view', () => {
    expect(listConsumableServicesQuerySchema.safeParse({ status: 'unfinished' }).success).toBe(true);
  });
  it('accepts only manual ml/gm package configuration', () => {
    expect(configureConsumableSchema.parse({ unit: 'ml', packageSize: '150', branchId: 2 }))
      .toEqual({ unit: 'ml', packageSize: '150.000', branchId: 2 });
    expect(() => configureConsumableSchema.parse({ unit: 'l', packageSize: '1' })).toThrow();
    expect(() => configureConsumableSchema.parse({ unit: 'gm', packageSize: '0' })).toThrow();
    expect(() => configureConsumableSchema.parse({ unit: 'gm', packageSize: '123456789012.001' })).toThrow();
    expect(recordServiceConsumptionsSchema.parse({
      serviceQueueEntryIds: [11], usages: [{ productId: 7, quantity: '1234567890123.001' }], noConsumablesConfirmed: false,
    }).usages[0]?.quantity).toBe('1234567890123.001');
  });

  it('moves only positive whole package counts in either direction', () => {
    expect(transferConsumableStockSchema.parse({ direction: 'reserve', packages: 2 }))
      .toMatchObject({ direction: 'reserve', packages: 2 });
    expect(transferConsumableStockSchema.parse({ direction: 'return', packages: 1 }))
      .toMatchObject({ direction: 'return', packages: 1 });
    expect(() => transferConsumableStockSchema.parse({ direction: 'return', packages: 1.5 })).toThrow();
  });

  it('bulk-completes individual service executions with the same actual usage', () => {
    const value = recordServiceConsumptionsSchema.parse({
      serviceQueueEntryIds: [11, 12],
      usages: [{ productId: 7, quantity: '15.5' }],
      noConsumablesConfirmed: false,
    });
    expect(value.usages).toEqual([{ productId: 7, quantity: '15.500' }]);
    expect(() => recordServiceConsumptionsSchema.parse({
      serviceQueueEntryIds: [11, 11], usages: [], noConsumablesConfirmed: true,
    })).toThrow();
  });

  it('requires an explicit reason for correction and supports no-consumables completion', () => {
    expect(correctServiceExecutionSchema.parse({ reason: 'تم تصحيح القياس', usages: [] }))
      .toMatchObject({ reason: 'تم تصحيح القياس', usages: [] });
    expect(() => correctServiceExecutionSchema.parse({ reason: '', usages: [] })).toThrow();
  });

  it('filters service executions by completion state and shift', () => {
    expect(listConsumableServicesQuerySchema.parse({ status: 'in_progress', consumptionStatus: 'unrecorded', cashierSessionId: '8', invoiceId: '44' }))
      .toMatchObject({ status: 'in_progress', consumptionStatus: 'unrecorded', cashierSessionId: 8, invoiceId: 44, page: 1, pageSize: 20 });
  });
});

import { describe, expect, it } from 'vitest';

import {
  categoryIdParamsSchema,
  createCategorySchema,
  createServiceSchema,
  listCategoriesQuerySchema,
  listServicesQuerySchema,
  serviceCommissionOverrideParamsSchema,
  serviceIdParamsSchema,
  setServiceCommissionOverrideSchema,
  updateCategorySchema,
  updateServiceSchema,
} from './index.js';

const category = { name: '  شعر  ', type: 'service' as const };
const service = { name: '  صبغة  ', categoryId: 3, price: '150' };

describe('erp category contracts', () => {
  it('trims the name and accepts both locked type values', () => {
    expect(createCategorySchema.parse(category)).toEqual({ name: 'شعر', type: 'service' });
    expect(createCategorySchema.parse({ ...category, type: 'expense' }).type).toBe('expense');
  });

  it('rejects any category type outside the locked pair', () => {
    expect(createCategorySchema.safeParse({ ...category, type: 'product' }).success).toBe(false);
  });

  it('rejects unknown fields so a client cannot smuggle server-owned columns', () => {
    expect(createCategorySchema.safeParse({ ...category, isActive: false }).success).toBe(false);
    expect(createCategorySchema.safeParse({ ...category, id: 5 }).success).toBe(false);
  });

  it('measures the name limit in code points, matching VARCHAR character semantics', () => {
    const astral = '𞤀';
    expect(createCategorySchema.safeParse({ ...category, name: astral.repeat(255) }).success).toBe(true);
    expect(createCategorySchema.safeParse({ ...category, name: astral.repeat(256) }).success).toBe(false);
  });

  it('keeps the category type immutable once created', () => {
    // Services already point at this category; re-typing it would silently
    // move them into the expense catalog.
    expect(updateCategorySchema.safeParse({ type: 'expense' }).success).toBe(false);
  });

  it('requires at least one editable field on update and ignores a bare branch scope', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
    expect(updateCategorySchema.safeParse({ branchId: 1 }).success).toBe(false);
    expect(updateCategorySchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('coerces the list filters a browser sends as query strings', () => {
    expect(listCategoriesQuerySchema.parse({ type: 'service', isActive: 'false' }))
      .toEqual({ type: 'service', isActive: false, page: 1, pageSize: 20 });
    expect(listCategoriesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('caps coerced category ids at the signed 32-bit INT range', () => {
    expect(categoryIdParamsSchema.parse({ id: '2147483647' })).toEqual({ id: 2147483647 });
    expect(categoryIdParamsSchema.safeParse({ id: '2147483648' }).success).toBe(false);
  });
});

describe('erp service contracts', () => {
  it('trims the name and normalizes the fixed price to exact two decimals', () => {
    expect(createServiceSchema.parse(service)).toEqual({
      name: 'صبغة',
      categoryId: 3,
      price: '150.00',
      commissionPercent: '0.00',
    });
  });

  it.each([['0150.5', '150.50'], ['150.55', '150.55'], ['0.01', '0.01']])(
    'normalizes the typed price %s to %s',
    (input, expected) => {
      expect(createServiceSchema.parse({ ...service, price: input }).price).toBe(expected);
    },
  );

  it('rejects a zero, negative, float or over-precise price', () => {
    // Money never arrives as a float: a JS number cannot represent 0.1 exactly.
    expect(createServiceSchema.safeParse({ ...service, price: 150 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...service, price: '0' }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...service, price: '0.00' }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...service, price: '-5.00' }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...service, price: '5.005' }).success).toBe(false);
  });

  it('keeps a zero default commission but rejects a rate above 100 percent', () => {
    expect(createServiceSchema.parse({ ...service, commissionPercent: '0' }).commissionPercent)
      .toBe('0.00');
    expect(createServiceSchema.parse({ ...service, commissionPercent: '12.5' }).commissionPercent)
      .toBe('12.50');
    expect(createServiceSchema.parse({ ...service, commissionPercent: '100' }).commissionPercent)
      .toBe('100.00');
    expect(createServiceSchema.safeParse({ ...service, commissionPercent: '100.01' }).success)
      .toBe(false);
    expect(createServiceSchema.safeParse({ ...service, commissionPercent: '-1' }).success)
      .toBe(false);
  });

  it('accepts an optional description and treats an empty one as absent', () => {
    expect(createServiceSchema.parse({ ...service, description: '  وصف  ' }).description)
      .toBe('وصف');
    expect(createServiceSchema.parse({ ...service, description: '   ' }).description).toBeNull();
  });

  it('rejects unknown fields so a client cannot smuggle server-owned columns', () => {
    expect(createServiceSchema.safeParse({ ...service, isActive: false }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...service, branchId: 2 }).success).toBe(true);
  });

  it('requires at least one editable field on update and ignores a bare branch scope', () => {
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
    expect(updateServiceSchema.safeParse({ branchId: 1 }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateServiceSchema.parse({ price: '99.9' }).price).toBe('99.90');
  });

  it('lets an update clear the description back to nothing', () => {
    expect(updateServiceSchema.parse({ description: '' }).description).toBeNull();
  });

  it('coerces the browsing filters the POS sends as query strings', () => {
    expect(listServicesQuerySchema.parse({ isActive: 'true', categoryId: '4' }))
      .toEqual({ isActive: true, categoryId: 4, page: 1, pageSize: 20 });
    expect(listServicesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('caps coerced service ids at the signed 32-bit INT range', () => {
    expect(serviceIdParamsSchema.parse({ id: '2147483647' })).toEqual({ id: 2147483647 });
    expect(serviceIdParamsSchema.safeParse({ id: '2147483648' }).success).toBe(false);
  });
});

describe('erp service commission override contracts', () => {
  it('requires an employee and an exact percentage', () => {
    expect(setServiceCommissionOverrideSchema.parse({ employeeId: 7, commissionPercent: '20' }))
      .toEqual({ employeeId: 7, commissionPercent: '20.00' });
  });

  it('allows a zero override so one employee can earn nothing on a service', () => {
    expect(setServiceCommissionOverrideSchema.parse({ employeeId: 7, commissionPercent: '0' })
      .commissionPercent).toBe('0.00');
  });

  it('rejects an out-of-range or missing override rate', () => {
    expect(setServiceCommissionOverrideSchema.safeParse({ employeeId: 7 }).success).toBe(false);
    expect(setServiceCommissionOverrideSchema
      .safeParse({ employeeId: 7, commissionPercent: '101' }).success).toBe(false);
  });

  it('coerces both path identifiers', () => {
    expect(serviceCommissionOverrideParamsSchema.parse({ id: '3', employeeId: '7' }))
      .toEqual({ id: 3, employeeId: 7 });
  });
});

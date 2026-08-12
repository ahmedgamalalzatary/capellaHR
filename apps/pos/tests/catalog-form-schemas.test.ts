import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  categoryFormSchema,
  commissionOverrideFormSchema,
  serviceFormSchema,
} from '../src/features/catalog/schemas/catalog-schemas';

test('service descriptions do not assume the contract field is wrapped', () => {
  const path = resolve('src/features/catalog/schemas/catalog-schemas.ts');
  expect(readFileSync(path, 'utf8')).not.toContain('createServiceSchema.shape.description.unwrap()');
});

describe('categoryFormSchema', () => {
  test('trims the name and keeps the chosen type', () => {
    expect(categoryFormSchema.parse({ name: '  شعر  ', type: 'service' }))
      .toEqual({ name: 'شعر', type: 'service' });
  });

  test('asks for a name in Arabic when it is blank', () => {
    const result = categoryFormSchema.safeParse({ name: '   ', type: 'service' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('اسم التصنيف مطلوب');
  });
});

describe('serviceFormSchema', () => {
  const service = { name: 'صبغة', categoryId: '3', price: '150', commissionPercent: '10' };

  test('coerces the select value and normalizes the money the same way the server does', () => {
    expect(serviceFormSchema.parse(service)).toMatchObject({
      name: 'صبغة',
      categoryId: 3,
      price: '150.00',
      commissionPercent: '10.00',
    });
  });

  test('rejects a zero price with the server\'s Arabic message', () => {
    const result = serviceFormSchema.safeParse({ ...service, price: '0' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('السعر يجب أن يكون أكبر من صفر');
  });

  test('rejects a commission above 100 percent', () => {
    expect(serviceFormSchema.safeParse({ ...service, commissionPercent: '120' }).success)
      .toBe(false);
  });

  test('defaults an omitted commission to zero and an empty description to null', () => {
    const parsed = serviceFormSchema.parse({ ...service, commissionPercent: '', description: '' });

    expect(parsed.commissionPercent).toBe('0.00');
    expect(parsed.description).toBeNull();
  });

  test('converts a blank optional price to an open price', () => {
    expect(serviceFormSchema.parse({ ...service, price: '' }).price).toBeNull();
  });
});

describe('commissionOverrideFormSchema', () => {
  test('coerces the employee select value and normalizes the rate', () => {
    expect(commissionOverrideFormSchema.parse({ employeeId: '7', commissionPercent: '20' }))
      .toEqual({ employeeId: 7, commissionPercent: '20.00' });
  });

  test('requires an employee to be chosen', () => {
    const result = commissionOverrideFormSchema.safeParse({ employeeId: '', commissionPercent: '20' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('يجب اختيار الموظف');
  });
});

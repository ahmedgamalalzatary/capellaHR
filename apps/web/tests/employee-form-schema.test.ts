import { describe, expect, test } from 'vitest';

import {
  employeeCreateFormSchema,
  employeeUpdateFormSchema,
} from '../src/features/employees/schemas/employee-form';

const image = (name = 'photo.jpg') => new File(['x'], name, { type: 'image/jpeg' });

const oversizedImage = () => {
  const file = image('large.jpg');
  Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 + 1 });
  return file;
};

const validCreate = {
  fullName: 'أحمد جمال',
  personalPhone: '010 1234-5678',
  whatsappPhone: '+20 111 234 5678',
  pin: '1234',
  age: '28',
  address: 'مدينة نصر، القاهرة',
  branchId: '3',
  shiftDurationMinutes: '480',
  monthlyBaseSalary: '6500.5',
  personal: image(),
  idFront: image('front.png'),
  idBack: image('back.png'),
};

describe('employeeCreateFormSchema', () => {
  test('accepts a full employee and normalizes phones and numbers', () => {
    const parsed = employeeCreateFormSchema.parse(validCreate);
    expect(parsed.personalPhone).toBe('01012345678');
    expect(parsed.whatsappPhone).toBe('01112345678');
    expect(parsed.age).toBe(28);
    expect(parsed.branchId).toBe(3);
    expect(parsed.shiftDurationMinutes).toBe(480);
    expect(parsed.monthlyBaseSalary).toBe('6500.5');
  });

  test('rejects invalid Egyptian phones with an Arabic message', () => {
    const result = employeeCreateFormSchema.safeParse({ ...validCreate, personalPhone: '12345' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('رقم الهاتف المصري غير صالح');
  });

  test('rejects Arabic-Indic phone digits with a Western-digit instruction', () => {
    const result = employeeCreateFormSchema.safeParse({
      ...validCreate,
      personalPhone: '٠١٠١٢٣٤٥٦٧٨',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('استخدم الأرقام الإنجليزية من 0 إلى 9');
  });

  test('requires a four-digit PIN', () => {
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, pin: '12' }).success).toBe(false);
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, pin: 'abcd' }).success).toBe(false);
  });

  test('leaves the shift-duration range to the API', () => {
    expect(employeeCreateFormSchema.parse({
      ...validCreate,
      shiftDurationMinutes: '721',
    }).shiftDurationMinutes).toBe(721);
  });

  test('rejects a non-positive or malformed salary', () => {
    expect(
      employeeCreateFormSchema.safeParse({ ...validCreate, monthlyBaseSalary: '0' }).success,
    ).toBe(false);
    expect(
      employeeCreateFormSchema.safeParse({ ...validCreate, monthlyBaseSalary: '12.345' }).success,
    ).toBe(false);
  });

  test('rejects whitespace-only numeric fields instead of coercing them to zero', () => {
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, age: '   ' }).success).toBe(false);
    expect(
      employeeCreateFormSchema.safeParse({ ...validCreate, shiftDurationMinutes: '\t ' }).success,
    ).toBe(false);
  });

  test('requires all three images and rejects non-image files', () => {
    const { personal: _personal, ...missing } = validCreate;
    expect(employeeCreateFormSchema.safeParse(missing).success).toBe(false);
    expect(
      employeeCreateFormSchema.safeParse({
        ...validCreate,
        idFront: new File(['x'], 'doc.pdf', { type: 'application/pdf' }),
      }).success,
    ).toBe(false);
  });

  test('leaves image byte-size enforcement to the API', () => {
    expect(employeeCreateFormSchema.safeParse({
      ...validCreate,
      personal: oversizedImage(),
    }).success).toBe(true);
  });
});

describe('employeeUpdateFormSchema', () => {
  test('allows partial edits with optional pin and images', () => {
    const parsed = employeeUpdateFormSchema.parse({
      fullName: 'اسم جديد',
      personalPhone: '01012345678',
      whatsappPhone: '01112345678',
      pin: '',
      age: '30',
      address: 'العنوان',
      branchId: '4',
      shiftDurationMinutes: '300',
    });
    expect(parsed.pin).toBeUndefined();
    expect(parsed.personal).toBeUndefined();
    expect(parsed.branchId).toBe(4);
  });

  test('still validates a provided pin', () => {
    expect(
      employeeUpdateFormSchema.safeParse({
        fullName: 'اسم',
        personalPhone: '01012345678',
        whatsappPhone: '01112345678',
        pin: '99',
        age: '30',
        address: 'العنوان',
        shiftDurationMinutes: '300',
      }).success,
    ).toBe(false);
  });
});

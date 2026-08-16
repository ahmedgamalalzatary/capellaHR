import { describe, expect, test } from 'vitest';

import { clientFormSchema } from '../src/features/clients/schemas/client-schemas';

describe('clientFormSchema', () => {
  test('requires a name or a phone, not both', () => {
    const result = clientFormSchema.safeParse({ fullName: '   ', phone: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message))
      .toContain('أدخل اسم العميل أو رقم هاتفه على الأقل');
  });

  test('accepts a walk-in known only by name', () => {
    expect(clientFormSchema.parse({ fullName: 'ندى', phone: '  ' }))
      .toEqual({ fullName: 'ندى' });
  });

  test('accepts a booking known only by number', () => {
    expect(clientFormSchema.parse({ fullName: '', phone: '+20 100 123 4567' }))
      .toEqual({ phone: '01001234567' });
  });

  test('normalizes the phone the same way the server contract does', () => {
    expect(clientFormSchema.parse({ fullName: 'ندى', phone: '+20 100 123 4567' }))
      .toEqual({ fullName: 'ندى', phone: '01001234567' });
  });

  test('rejects a number that is not an Egyptian mobile', () => {
    expect(clientFormSchema.safeParse({ fullName: 'ندى', phone: '01301234567' }).success).toBe(false);
  });

  test('rejects Arabic-Indic digits instead of converting them', () => {
    expect(clientFormSchema.safeParse({ fullName: 'ندى', phone: '٠١٠٠١٢٣٤٥٦٧' }).success).toBe(false);
  });
});

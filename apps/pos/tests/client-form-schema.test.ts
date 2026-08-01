import { describe, expect, test } from 'vitest';

import { clientFormSchema } from '../src/features/clients/schemas/client-schemas';

describe('clientFormSchema', () => {
  test('requires a name and a phone with Arabic messages', () => {
    const result = clientFormSchema.safeParse({ fullName: '   ', phone: '' });

    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages).toContain('اسم العميل مطلوب');
    expect(messages).toContain('رقم الهاتف مطلوب');
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

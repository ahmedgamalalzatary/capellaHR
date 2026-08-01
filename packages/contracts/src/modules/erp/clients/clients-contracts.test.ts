import { describe, expect, it } from 'vitest';

import {
  clientIdParamsSchema,
  createClientSchema,
  findClientByPhoneQuerySchema,
  listClientsQuerySchema,
  updateClientSchema,
} from './index.js';

const client = { fullName: '  ندى سمير  ', phone: '01001234567' };

describe('client contracts', () => {
  it('trims the name and keeps an already-normalized phone', () => {
    expect(createClientSchema.parse(client)).toEqual({ fullName: 'ندى سمير', phone: '01001234567' });
  });

  it.each([
    ['+20 100 123 4567', '01001234567'],
    ['010-0123-4567', '01001234567'],
    ['0100 123 4567', '01001234567'],
  ])('normalizes the counter-typed phone %s', (input, expected) => {
    expect(createClientSchema.parse({ ...client, phone: input }).phone).toBe(expected);
  });

  it('rejects Arabic-Indic digits rather than silently converting them', () => {
    const result = createClientSchema.safeParse({ ...client, phone: '٠١٠٠١٢٣٤٥٦٧' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('استخدم الأرقام الإنجليزية من 0 إلى 9');
  });

  it.each(['01301234567', '01901234567', '0100123456', '010012345678'])(
    'rejects %s as a non-Egyptian-mobile number',
    (phone) => {
      expect(createClientSchema.safeParse({ ...client, phone }).success).toBe(false);
    },
  );

  it('measures the name limit in code points, matching VARCHAR character semantics', () => {
    // U+1E900 is an astral character: 2 UTF-16 units but 1 character in MySQL utf8mb4.
    const astral = '𞤀';
    expect(createClientSchema.safeParse({ ...client, fullName: astral.repeat(255) }).success).toBe(true);
    expect(createClientSchema.safeParse({ ...client, fullName: astral.repeat(256) }).success).toBe(false);
  });

  it('rejects unknown fields so a client cannot smuggle server-owned columns', () => {
    expect(createClientSchema.safeParse({ ...client, id: 5 }).success).toBe(false);
    expect(createClientSchema.safeParse({ ...client, createdAt: new Date() }).success).toBe(false);
  });

  it('requires at least one editable field on update', () => {
    expect(updateClientSchema.safeParse({}).success).toBe(false);
    expect(updateClientSchema.safeParse({ fullName: 'ندى' }).success).toBe(true);
  });

  it('does not treat a branch scope alone as an edit', () => {
    // branchId only tells the server which branch to act on; it changes nothing.
    expect(updateClientSchema.safeParse({ branchId: 1 }).success).toBe(false);
  });

  it('normalizes the phone used for exact lookup', () => {
    expect(findClientByPhoneQuerySchema.parse({ phone: '+20 111 222 3344' }).phone).toBe('01112223344');
  });

  it('normalizes list pagination defaults', () => {
    expect(listClientsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('caps coerced client ids at the signed 32-bit INT range', () => {
    expect(clientIdParamsSchema.parse({ id: '2147483647' })).toEqual({ id: 2147483647 });
    expect(clientIdParamsSchema.safeParse({ id: '2147483648' }).success).toBe(false);
  });
});

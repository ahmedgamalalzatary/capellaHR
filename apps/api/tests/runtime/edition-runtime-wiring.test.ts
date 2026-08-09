import { resolveEdition } from '@capella/config/edition';
import type { createDatabase } from '@capella/database';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

const repositoryCalls = vi.hoisted(() => vi.fn());

vi.mock('../../src/modules/employees/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/employees/index.js')>();
  return {
    ...actual,
    createDrizzleEmployeeRepository: (...args: Parameters<typeof actual.createDrizzleEmployeeRepository>) => {
      repositoryCalls(...args);
      return actual.createDrizzleEmployeeRepository(...args);
    },
  };
});

import { createApiRuntime } from '../../src/runtime/api-runtime.js';

describe('API edition dependency wiring', () => {
  it('reconciles due absences before employee shift-duration changes', () => {
    createApiRuntime({
      database: {} as ReturnType<typeof createDatabase>,
      edition: resolveEdition('full'),
      logger: pino({ level: 'silent' }),
      timeZone: 'Africa/Cairo',
      maxEmployeeImageBytes: 16_777_216,
    });

    expect(repositoryCalls).toHaveBeenCalledOnce();
    expect(repositoryCalls.mock.calls[0]?.[2]).toEqual(expect.any(Function));
  });
});

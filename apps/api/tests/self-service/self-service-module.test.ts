import { describe, expect, it } from 'vitest';

import { createSelfServiceModule } from '../../src/modules/self-service/index.js';

describe('self-service module', () => {
  it('exposes the composed employee read service', () => {
    const dependencies = {
      employees: { get: async () => ({ branchId: 1 }) },
      branches: { get: async () => ({}) },
      weeklyDays: { list: async () => ({ items: [], total: 0 }) },
      payroll: { getBaseSalary: async () => ({}), preview: async () => ({}) },
      bonuses: { list: async () => ({ items: [], total: 0 }) },
      deductions: { list: async () => ({ items: [], total: 0 }) },
      advances: { list: async () => ({ items: [], total: 0 }) },
    };

    const module = createSelfServiceModule(dependencies as never);

    expect(module.service).toBeDefined();
    expect(module.service).toHaveProperty('getOverview');
  });
});

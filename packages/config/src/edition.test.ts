import { describe, expect, it } from 'vitest';

import {
  EDITION_NAMES,
  MODULE_REGISTRY,
  assertEditionProfile,
  assertFrontendEdition,
  resolveEdition,
  type ModuleName,
} from './edition.js';

const sorted = (modules: readonly ModuleName[]) => [...modules].sort();

describe('edition registry', () => {
  it('resolves a missing edition to the always-on core floor', () => {
    expect(resolveEdition(undefined)).toEqual({
      edition: 'core',
      modules: ['auth', 'branches', 'employees', 'audit'],
    });
  });

  it('expands HR dependencies without enabling ERP modules', () => {
    const resolved = resolveEdition('hr');

    expect(resolved.edition).toBe('hr');
    expect(sorted(resolved.modules)).toEqual(sorted([
      'auth', 'branches', 'employees', 'audit',
      'devices', 'shifts', 'attendance', 'weekly-day-offs', 'payroll',
      'bonuses', 'deductions', 'advances', 'reports', 'self-service', 'dashboard',
    ]));
    expect(resolved.modules).not.toContain('erp-sales');
  });

  it('includes Attendance support in ERP without enabling Payroll or HR-only modules', () => {
    const resolved = resolveEdition('erp');

    expect(sorted(resolved.modules)).toEqual(sorted([
      'auth', 'branches', 'employees', 'audit',
      'devices', 'shifts', 'attendance', 'reports',
      'erp-assignment', 'erp-catalog', 'erp-clients', 'erp-stock',
      'erp-suppliers', 'erp-expenses', 'erp-sales', 'erp-commissions', 'erp-reports',
    ]));
    expect(resolved.modules).not.toContain('payroll');
    expect(resolved.modules).not.toContain('self-service');
  });

  it('resolves full to the union of the public HR and ERP editions', () => {
    const full = resolveEdition('full');
    const expected = new Set([
      ...resolveEdition('hr').modules,
      ...resolveEdition('erp').modules,
    ]);

    expect(new Set(full.modules)).toEqual(expected);
  });

  it('rejects every explicitly supplied unknown edition', () => {
    expect(() => resolveEdition('enterprise')).toThrow(
      'Unknown EDITION "enterprise". Expected one of: hr, erp, full.',
    );
  });

  it('rejects a deployment profile that does not match the resolved edition', () => {
    expect(() => assertEditionProfile(resolveEdition('full'), 'hr')).toThrow(
      'COMPOSE_PROFILES="hr" must match EDITION="full".',
    );
    expect(assertEditionProfile(resolveEdition('erp'), 'erp').edition).toBe('erp');
    expect(assertEditionProfile(resolveEdition('hr'), undefined).edition).toBe('hr');
  });

  it('publishes only the three supported edition names and classified modules', () => {
    expect(EDITION_NAMES).toEqual(['hr', 'erp', 'full']);
    expect(MODULE_REGISTRY.auth.classification).toBe('core');
    expect(MODULE_REGISTRY.devices.classification).toBe('support');
    expect(MODULE_REGISTRY.payroll.classification).toBe('sellable');
    expect(MODULE_REGISTRY.bonuses.requires).toContain('payroll');
    expect(MODULE_REGISTRY.attendance.requires).toEqual(['devices', 'shifts']);
    expect(MODULE_REGISTRY['weekly-day-offs'].requires).toEqual(['payroll']);
  });

  it('allows each dedicated frontend only in editions that include its product plane', () => {
    expect(assertFrontendEdition('hr', 'web').edition).toBe('hr');
    expect(assertFrontendEdition('erp', 'web').edition).toBe('erp');
    expect(assertFrontendEdition('full', 'web').edition).toBe('full');
    expect(assertFrontendEdition('erp', 'pos').edition).toBe('erp');
    expect(assertFrontendEdition('full', 'pos').edition).toBe('full');

    expect(() => assertFrontendEdition('hr', 'pos')).toThrow(
      'The POS frontend is not available in EDITION="hr".',
    );
    expect(() => assertFrontendEdition(undefined, 'pos')).toThrow(
      'The POS frontend is not available in the core-only configuration.',
    );
  });
});

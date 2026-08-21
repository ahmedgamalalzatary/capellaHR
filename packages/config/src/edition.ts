export const EDITION_NAMES = ['hr', 'erp', 'full'] as const;

export type EditionName = (typeof EDITION_NAMES)[number];
export type ResolvedEditionName = EditionName | 'core';
export type ModuleClassification = 'core' | 'sellable' | 'support';

export const MODULE_NAMES = [
  'auth', 'branches', 'employees', 'audit',
  'devices', 'shifts',
  'attendance', 'weekly-day-offs', 'payroll', 'bonuses', 'deductions', 'advances',
  'reports', 'self-service', 'dashboard',
  'erp-assignment', 'erp-catalog', 'erp-clients', 'erp-stock', 'erp-suppliers',
  'erp-expenses', 'erp-sales', 'erp-commissions', 'erp-reports', 'erp-transfers',
  'erp-fixed-assets',
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

const module = <const TRequires extends readonly ModuleName[]>(
  classification: ModuleClassification,
  requires: TRequires,
) => ({ classification, requires });

export const MODULE_REGISTRY = {
  auth: module('core', []),
  branches: module('core', []),
  employees: module('core', []),
  audit: module('core', []),

  devices: module('support', []),
  shifts: module('support', []),

  attendance: module('sellable', ['devices', 'shifts']),
  'weekly-day-offs': module('sellable', ['payroll']),
  payroll: module('sellable', ['attendance']),
  bonuses: module('sellable', ['payroll']),
  deductions: module('sellable', ['payroll']),
  advances: module('sellable', ['payroll']),
  reports: module('sellable', []),
  'self-service': module('sellable', [
    'attendance',
    'weekly-day-offs',
    'payroll',
    'bonuses',
    'deductions',
    'advances',
  ]),
  dashboard: module('sellable', ['attendance', 'payroll', 'reports']),

  'erp-assignment': module('sellable', ['attendance']),
  'erp-catalog': module('sellable', []),
  'erp-clients': module('sellable', []),
  'erp-stock': module('sellable', []),
  'erp-suppliers': module('sellable', ['erp-stock']),
  'erp-expenses': module('sellable', []),
  // A written-down list of the branch's own furniture and machines. Nothing
  // reads it and it reads nothing: a leaf, on purpose.
  'erp-fixed-assets': module('sellable', []),
  'erp-sales': module('sellable', ['erp-assignment']),
  // Moving stock between branches is a sale from one branch to the other.
  'erp-transfers': module('sellable', ['erp-stock', 'erp-sales']),
  'erp-commissions': module('sellable', ['erp-sales']),
  'erp-reports': module('sellable', [
    'reports',
    'erp-catalog',
    'erp-clients',
    'erp-stock',
    'erp-suppliers',
    'erp-expenses',
    'erp-sales',
    'erp-commissions',
  ]),
} as const satisfies Record<ModuleName, {
  classification: ModuleClassification;
  requires: readonly ModuleName[];
}>;

const HR_MODULES: readonly ModuleName[] = [
  'attendance',
  'weekly-day-offs',
  'payroll',
  'bonuses',
  'deductions',
  'advances',
  'reports',
  'self-service',
  'dashboard',
];
const ERP_MODULES: readonly ModuleName[] = [
  'attendance',
  'reports',
  'erp-assignment',
  'erp-catalog',
  'erp-clients',
  'erp-stock',
  'erp-suppliers',
  'erp-expenses',
  'erp-sales',
  'erp-commissions',
  'erp-reports',
  'erp-transfers',
  'erp-fixed-assets',
];

const EDITION_ROOTS: Record<EditionName, readonly ModuleName[]> = {
  hr: HR_MODULES,
  erp: ERP_MODULES,
  full: [...HR_MODULES, ...ERP_MODULES],
};

const CORE_MODULES = MODULE_NAMES.filter(
  (name) => MODULE_REGISTRY[name].classification === 'core',
);

const isEditionName = (value: string): value is EditionName => (
  (EDITION_NAMES as readonly string[]).includes(value)
);

const expand = (roots: readonly ModuleName[]) => {
  const enabled = new Set<ModuleName>(CORE_MODULES);
  const visiting = new Set<ModuleName>();

  const visit = (name: ModuleName) => {
    if (enabled.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular module dependency at "${name}".`);
    visiting.add(name);
    for (const dependency of MODULE_REGISTRY[name].requires) {
      visit(dependency);
    }
    visiting.delete(name);
    enabled.add(name);
  };

  for (const root of roots) visit(root);
  return MODULE_NAMES.filter((name) => enabled.has(name));
};

export interface ResolvedEdition {
  edition: ResolvedEditionName;
  modules: readonly ModuleName[];
}

export const resolveEdition = (value: string | undefined): ResolvedEdition => {
  if (value === undefined) return { edition: 'core', modules: CORE_MODULES };
  if (!isEditionName(value)) {
    throw new Error(
      `Unknown EDITION "${value}". Expected one of: ${EDITION_NAMES.join(', ')}.`,
    );
  }
  return { edition: value, modules: expand(EDITION_ROOTS[value]) };
};

export const hasModule = (
  edition: ResolvedEdition,
  moduleName: ModuleName,
) => edition.modules.includes(moduleName);

export const assertEditionProfile = (
  edition: ResolvedEdition,
  composeProfiles: string | undefined,
) => {
  if (composeProfiles !== undefined && composeProfiles !== edition.edition) {
    throw new Error(
      `COMPOSE_PROFILES="${composeProfiles}" must match EDITION="${edition.edition}".`,
    );
  }
  return edition;
};

export type FrontendName = 'web' | 'pos';

export const assertFrontendEdition = (
  value: string | undefined,
  frontend: FrontendName,
) => {
  const resolved = resolveEdition(value);
  const allowed = frontend === 'web'
    ? resolved.edition !== 'core'
    : resolved.edition === 'erp' || resolved.edition === 'full';
  if (allowed) return resolved;

  const label = frontend === 'web' ? 'HR/attendance frontend' : 'POS frontend';
  const configuration = resolved.edition === 'core'
    ? 'the core-only configuration'
    : `EDITION="${resolved.edition}"`;
  throw new Error(`The ${label} is not available in ${configuration}.`);
};

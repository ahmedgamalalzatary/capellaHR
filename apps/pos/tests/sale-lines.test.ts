import { describe, expect, it } from 'vitest';

import type { ServiceListItem } from '../src/features/catalog';
import type { AssignableEmployee } from '../src/features/employee-assignment';
import {
  appendServiceLine,
  decrementLine,
  incrementLine,
  removeLine,
  restoredLines,
  type Line,
} from '../src/features/sales/components/sale-primitives';

const service = {
  id: 21,
  branchId: 2,
  categoryId: 1,
  categoryName: 'شعر',
  categoryIsActive: true,
  name: 'صبغة شعر',
  description: null,
  price: '200.00',
  commissionPercent: '10.00',
  isActive: true,
  createdAt: '',
  updatedAt: '',
} as ServiceListItem;

const employeeA = { id: 8, employeeCode: 1008, fullName: 'سارة' } as AssignableEmployee;
const employeeB = { id: 11, employeeCode: 1011, fullName: 'هدى' } as AssignableEmployee;

const serviceLine = (overrides: Partial<Line> = {}): Line => ({
  lineId: 'line-1',
  service,
  quantity: 1,
  unitPrice: '200.00',
  itemType: 'service',
  employee: employeeA,
  ...overrides,
});

describe('appendServiceLine', () => {
  it('adds a brand-new line for a service that is already in the basket, so each unit can name its own employee', () => {
    const existing = serviceLine({ lineId: 'existing', employee: employeeA });
    const next = appendServiceLine([existing], service, employeeB, () => 'line-2');

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(existing);
    expect(next[1]).toMatchObject({
      lineId: 'line-2',
      quantity: 1,
      unitPrice: '200.00',
      itemType: 'service',
      employee: employeeB,
    });
    // The original line is untouched: no merge, no quantity bump.
    expect(next[0]!.quantity).toBe(1);
    expect(next[0]!.employee).toBe(employeeA);
  });

  it('pre-fills the chosen default employee on the new unit', () => {
    const next = appendServiceLine([], service, employeeA, () => 'line-1');
    expect(next[0]).toMatchObject({ employee: employeeA, quantity: 1 });
  });

  it('leaves the employee empty when no default is chosen', () => {
    const next = appendServiceLine([], service, null, () => 'line-1');
    expect(next[0]!.employee).toBeNull();
  });
});

describe('per-line quantity and removal', () => {
  it('targets only the addressed line when several lines share a service', () => {
    const lines = [
      serviceLine({ lineId: 'a', employee: employeeA }),
      serviceLine({ lineId: 'b', employee: employeeB }),
    ];
    expect(incrementLine(lines, 'a').map((line) => line.quantity)).toEqual([2, 1]);
    expect(decrementLine(lines, 'b')[1]!.quantity).toBe(1); // qty 1 line cannot drop below 1
    expect(removeLine(lines, 'a').map((line) => line.lineId)).toEqual(['b']);
  });

  it('removes a quantity-1 line when decremented is not allowed but removal is requested', () => {
    const lines = [serviceLine({ lineId: 'a' }), serviceLine({ lineId: 'b' })];
    expect(removeLine(lines, 'b')).toHaveLength(1);
  });
});

describe('restoredLines', () => {
  // Stored drafts predate per-line identity, so they carry no lineId.
  const stored = (overrides: Record<string, unknown> = {}) => ({
    service,
    quantity: 1,
    unitPrice: '200.00',
    itemType: 'service' as const,
    employee: null,
    ...overrides,
  });

  it('mints a fresh, unique lineId for every restored line', () => {
    const draft = {
      employee: null,
      lines: [stored(), stored(), stored({ itemType: 'product' })],
    } as unknown as { employee: null; lines: Line[] };

    const lines = restoredLines(draft);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => typeof line.lineId === 'string' && line.lineId.length > 0)).toBe(true);
    expect(new Set(lines.map((line) => line.lineId)).size).toBe(3);
  });

  it('keeps each line independent after restore, including the default-employee backfill', () => {
    const draft = {
      employee: employeeA,
      lines: [stored(), stored({ itemType: 'product', employee: null })],
    } as unknown as { employee: NonNullable<Line['employee']>; lines: Line[] };

    const lines = restoredLines(draft);
    expect(lines[0]!.employee).toBe(employeeA); // service backfilled from the draft default
    expect(lines[1]!.employee).toBeNull(); // products never carry a performer
    expect(lines[0]!.lineId).not.toBe(lines[1]!.lineId);
  });

  it('expands a legacy multi-quantity service into independently assignable unit lines', () => {
    const lines = restoredLines({
      employee: employeeA,
      lines: [stored({ quantity: 3 })],
    });

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.quantity)).toEqual([1, 1, 1]);
    expect(new Set(lines.map((line) => line.lineId)).size).toBe(3);
    expect(lines.every((line) => line.employee === employeeA)).toBe(true);
  });

  it('preserves an explicit empty employee on a current-draft line', () => {
    const [line] = restoredLines({
      employee: employeeA,
      lines: [stored({ lineId: 'current-line', employee: null })],
    });

    expect(line!.lineId).toBe('current-line');
    expect(line!.employee).toBeNull();
  });
});

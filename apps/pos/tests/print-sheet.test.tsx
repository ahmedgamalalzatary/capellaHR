import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintSheet } from '../src/features/erp-reports/components/print-sheet';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PrintSheet', () => {
  it('renders a one-column report summary in one cell spanning the report width', () => {
    vi.stubGlobal('print', vi.fn());
    render(<PrintSheet report={{
      title: 'Report', subtitle: 'Details',
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ id: 1, name: 'Item' }],
      summary: [{ label: 'Total', value: 1 }],
    }} onPrinted={vi.fn()} />);

    const footerRow = document.querySelector<HTMLElement>('#print-root tfoot tr')!;
    const cells = within(footerRow).getAllByRole('cell');
    expect(cells).toHaveLength(1);
    expect(cells[0]!.getAttribute('colspan')).toBe('1');
    expect(cells[0]!.textContent).toContain('Total');
    expect(cells[0]!.textContent).toContain('1');
  });
});

import { createErpReportsModule } from '@capella/api/erp-reports-runtime';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('ERP report worker runtime', () => {
  it('exposes the ERP reader composition to the independent worker process', () => {
    expect(createErpReportsModule).toEqual(expect.any(Function));
  });

  it('injects the ERP reader into the shared worker report runtime', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main).toContain('createErpReportsModule');
    expect(main).toContain('erp: erpReports.reader');
  });
});

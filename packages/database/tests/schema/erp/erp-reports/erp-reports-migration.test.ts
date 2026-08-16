import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));

describe('ERP reports migration', () => {
  it('extends the durable report queue with every ERP report type', () => {
    const name = readdirSync(migrationsDirectory).find((entry) => /^0057_.*\.sql$/.test(entry));
    expect(name).toBeDefined();
    const migration = readFileSync(`${migrationsDirectory}/${name!}`, 'utf8');
    expect(migration).toContain('erp-sales');
    expect(migration).toContain('erp-profit');
    expect(migration).toContain('erp-invoice');
    expect(migration).toContain('ALTER TABLE `report_exports`');
  });
});

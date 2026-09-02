import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const lineCount = (relativePath: string) => readFileSync(
  path.join(repositoryRoot, relativePath),
  'utf8',
).split(/\r?\n/u).length;

describe('sales source organization', () => {
  it.each([
    'apps/api/src/modules/erp/sales/sale-repository.ts',
    'apps/api/tests/erp/sale-repository-mysql.integration.test.ts',
    'apps/pos/tests/sales-view.test.tsx',
  ])('keeps %s below the established large-file boundary', (relativePath) => {
    expect(lineCount(relativePath)).toBeLessThanOrEqual(1_000);
  });
});

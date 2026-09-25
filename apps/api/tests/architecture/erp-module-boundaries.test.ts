import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const eslint = new ESLint({ cwd: apiRoot });

const restrictedMessages = async (source: string, relativePath: string) => {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(apiRoot, relativePath),
  });
  return result?.messages.filter(({ ruleId }) => ruleId === 'no-restricted-imports') ?? [];
};

describe('ERP module import boundaries', () => {
  // Spawns a real TypeScript compile, which takes seconds on its own and considerably
  // longer when the rest of the suite is competing for the same cores.
  it('keeps HR and ERP from importing each other across the boundary', { timeout: 90_000 }, async () => {
    // HR modules must not import ERP.
    await expect(restrictedMessages(
      "import '../erp/sales/index.js';",
      'src/modules/auth/index.ts',
    )).resolves.toHaveLength(1);

    // ERP modules must not import HR internals, from the root or deeply nested.
    await expect(restrictedMessages(
      "import '../../auth/auth-service.js';",
      'src/modules/erp/sales/index.ts',
    )).resolves.toHaveLength(1);
    await expect(restrictedMessages(
      "import '../auth/auth-service.js';",
      'src/modules/erp/index.ts',
    )).resolves.toHaveLength(1);
    await expect(restrictedMessages(
      "import '../../../auth/auth-service.js';",
      'src/modules/erp/sales/index.ts',
    )).resolves.toHaveLength(1);
  });

  it('lets the ERP capability bridge import public HR barrels but not HR internals', async () => {
    await expect(restrictedMessages(
      "import type { AuthService } from '../auth/index.js';",
      'src/modules/erp/hr-capabilities.ts',
    )).resolves.toHaveLength(0);

    await expect(restrictedMessages(
      "import type { AuthService } from '../auth/auth-service.js';",
      'src/modules/erp/hr-capabilities.ts',
    )).resolves.toHaveLength(1);
  });

  it('keeps ERP modules to each other public barrels, never internals', async () => {
    // One ERP module importing another module internals, at any depth.
    await expect(restrictedMessages(
      "import '../clients/clients-repository.js';",
      'src/modules/erp/sales/index.ts',
    )).resolves.toHaveLength(1);
    await expect(restrictedMessages(
      "import '../../clients/clients-repository.js';",
      'src/modules/erp/sales/services/index.ts',
    )).resolves.toHaveLength(1);

    // The ERP root importing submodule internals.
    await expect(restrictedMessages(
      "import './clients/clients-repository.js';",
      'src/modules/erp/index.ts',
    )).resolves.toHaveLength(1);

    // One ERP module importing another public barrel stays allowed.
    await expect(restrictedMessages(
      "import type { ClientCapability } from '../clients/index.js';",
      'src/modules/erp/sales/index.ts',
    )).resolves.toHaveLength(0);
  });

  it('keeps the ERP root to submodule public indexes, relative or aliased', async () => {
    await expect(restrictedMessages(
      "import './clients/index.js';",
      'src/modules/erp/index.ts',
    )).resolves.toHaveLength(0);

    await expect(restrictedMessages(
      "import '@/modules/erp/clients/clients-repository.js';",
      'src/modules/erp/index.ts',
    )).resolves.toHaveLength(1);

    await expect(restrictedMessages(
      "import '@/modules/erp/clients/index.js';",
      'src/modules/erp/index.ts',
    )).resolves.toHaveLength(0);
  });
});

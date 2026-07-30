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
  it('prevents HR modules from importing ERP', async () => {
    const messages = await restrictedMessages(
      "import '../erp/sales/index.js';",
      'src/modules/auth/index.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('prevents ERP modules from importing HR internals', async () => {
    const messages = await restrictedMessages(
      "import '../../auth/auth-service.js';",
      'src/modules/erp/sales/index.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('prevents root and deeply nested ERP files from importing HR directly', async () => {
    const rootMessages = await restrictedMessages(
      "import '../auth/auth-service.js';",
      'src/modules/erp/index.ts',
    );
    const nestedMessages = await restrictedMessages(
      "import '../../../auth/auth-service.js';",
      'src/modules/erp/sales/index.ts',
    );

    expect(rootMessages).toHaveLength(1);
    expect(nestedMessages).toHaveLength(1);
  });

  it('allows the ERP capability bridge to import public HR barrels', async () => {
    const messages = await restrictedMessages(
      "import type { AuthService } from '../auth/index.js';",
      'src/modules/erp/hr-capabilities.ts',
    );

    expect(messages).toHaveLength(0);
  });

  it('prevents the ERP capability bridge from importing HR internals', async () => {
    const messages = await restrictedMessages(
      "import type { AuthService } from '../auth/auth-service.js';",
      'src/modules/erp/hr-capabilities.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('prevents one ERP module from importing another module internals', async () => {
    const messages = await restrictedMessages(
      "import '../clients/clients-repository.js';",
      'src/modules/erp/sales/index.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('prevents deeply nested ERP files from importing another module internals', async () => {
    const messages = await restrictedMessages(
      "import '../../clients/clients-repository.js';",
      'src/modules/erp/sales/services/index.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('prevents the ERP root from importing submodule internals', async () => {
    const messages = await restrictedMessages(
      "import './clients/clients-repository.js';",
      'src/modules/erp/index.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('allows one ERP module to import another public barrel', async () => {
    const messages = await restrictedMessages(
      "import type { ClientCapability } from '../clients/index.js';",
      'src/modules/erp/sales/index.ts',
    );

    expect(messages).toHaveLength(0);
  });
});

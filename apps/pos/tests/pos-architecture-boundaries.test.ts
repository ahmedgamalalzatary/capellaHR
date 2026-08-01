import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const posRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.resolve(posRoot, '../web');

const posEslint = new ESLint({ cwd: posRoot });
const webEslint = new ESLint({ cwd: webRoot });

const restrictedMessages = async (eslint: ESLint, root: string, source: string, relativePath: string) => {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(root, relativePath),
  });
  return result?.messages.filter(({ ruleId }) => ruleId === 'no-restricted-imports') ?? [];
};

describe('POS feature and app boundaries', () => {
  it('prevents a feature from importing another feature internals', { timeout: 15_000 }, async () => {
    const messages = await restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth/hooks/use-session';",
      'src/features/cashier-accounts/components/cashier-accounts-view.tsx',
    );

    expect(messages).toHaveLength(1);
  });

  it('allows a feature to import another feature public index', async () => {
    const messages = await restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth';",
      'src/features/cashier-accounts/components/cashier-accounts-view.tsx',
    );

    expect(messages).toHaveLength(0);
  });

  it('allows a feature to import its own internals via a relative path', async () => {
    const messages = await restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '../hooks/use-session';",
      'src/features/auth/components/login-view.tsx',
    );

    expect(messages).toHaveLength(0);
  });

  it('prevents an app-level file from importing a feature internal path', async () => {
    const messages = await restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth/hooks/use-session';",
      'src/app/(protected)/page.tsx',
    );

    expect(messages).toHaveLength(1);
  });

  it('allows an app-level file to import a feature public index', async () => {
    const messages = await restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth';",
      'src/app/(protected)/page.tsx',
    );

    expect(messages).toHaveLength(0);
  });

  it('prevents apps/pos from importing apps/web', async () => {
    const messages = await restrictedMessages(
      posEslint,
      posRoot,
      "import { something } from '../../../../../web/src/lib/api/client';",
      'src/features/auth/api/auth-api.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('prevents apps/web from importing apps/pos', async () => {
    const messages = await restrictedMessages(
      webEslint,
      webRoot,
      "import { something } from '../../../../../pos/src/lib/api/client';",
      'src/features/auth/api/auth-api.ts',
    );

    expect(messages).toHaveLength(1);
  });

  it('allows unrelated relative imports within apps/pos', async () => {
    const messages = await restrictedMessages(
      posEslint,
      posRoot,
      "import { api } from '../../../lib/api/client';",
      'src/features/auth/api/auth-api.ts',
    );

    expect(messages).toHaveLength(0);
  });
});

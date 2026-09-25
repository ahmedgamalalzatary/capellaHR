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
  // This first case pays ESLint's cold start for the whole file, which needs
  // room when the monorepo runs every package's suite at once.
  it('keeps features to each other public indexes and their own internals', { timeout: 60_000 }, async () => {
    // A feature must not import another feature internals.
    await expect(restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth/hooks/use-session';",
      'src/features/cashier-accounts/components/cashier-accounts-view.tsx',
    )).resolves.toHaveLength(1);

    // A feature may import another feature public index.
    await expect(restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth';",
      'src/features/cashier-accounts/components/cashier-accounts-view.tsx',
    )).resolves.toHaveLength(0);

    // A feature may import its own internals via a relative path.
    await expect(restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '../hooks/use-session';",
      'src/features/auth/components/login-view.tsx',
    )).resolves.toHaveLength(0);
  });

  it('keeps app-level files to feature public indexes', async () => {
    await expect(restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth/hooks/use-session';",
      'src/app/(protected)/page.tsx',
    )).resolves.toHaveLength(1);

    await expect(restrictedMessages(
      posEslint,
      posRoot,
      "import { useSession } from '@/features/auth';",
      'src/app/(protected)/page.tsx',
    )).resolves.toHaveLength(0);
  });

  it('keeps apps/pos and apps/web isolated without blocking unrelated relative imports', async () => {
    await expect(restrictedMessages(
      posEslint,
      posRoot,
      "import { something } from '../../../../../web/src/lib/api/client';",
      'src/features/auth/api/auth-api.ts',
    )).resolves.toHaveLength(1);

    await expect(restrictedMessages(
      webEslint,
      webRoot,
      "import { something } from '../../../../../pos/src/lib/api/client';",
      'src/features/auth/api/auth-api.ts',
    )).resolves.toHaveLength(1);

    await expect(restrictedMessages(
      posEslint,
      posRoot,
      "import { api } from '../../../lib/api/client';",
      'src/features/auth/api/auth-api.ts',
    )).resolves.toHaveLength(0);
  });
});

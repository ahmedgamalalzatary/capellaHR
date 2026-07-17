import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'vitest/config';

const apiDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(apiDirectory, '../..');
loadEnvironment({ path: path.join(workspaceRoot, '.env.test'), override: true, quiet: true });
process.env.NODE_ENV = 'test';

export default defineConfig({
  envDir: workspaceRoot,
  test: { environment: 'node', setupFiles: ['@capella/testing/setup'], fileParallelism: false },
});

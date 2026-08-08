import { defineConfig, devices } from '@playwright/test';

import { parseE2ePort } from './playwright-port';

const port = parseE2ePort(process.env.POS_E2E_PORT);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: process.env.POS_E2E_OUTPUT_DIR ?? '../../test-results/pos',
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'wide-pos', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'compact-pos', use: { viewport: { width: 768, height: 1024 } } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

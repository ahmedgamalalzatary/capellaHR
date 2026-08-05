import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '../../test-results/pos',
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'wide-pos', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'compact-pos', use: { viewport: { width: 768, height: 1024 } } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

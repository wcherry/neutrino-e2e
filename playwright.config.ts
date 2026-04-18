import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const runDir = process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default';

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(runDir, 'playwright-artifacts'),

  // Run tests serially — all tests share a single Docker stack
  workers: 1,
  fullyParallel: false,

  // Retry once on CI to handle transient flakiness
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(runDir, 'playwright-report'), open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:9880',

    // Always record traces (useful for debugging failures)
    trace: 'on',

    // Screenshot only on failure
    screenshot: 'only-on-failure',

    // Record video on first retry
    video: 'on-first-retry',
  },

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

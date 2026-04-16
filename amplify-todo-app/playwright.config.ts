import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Raise the per-assertion timeout from the 5 s default to give AppSync
  // subscription round trips (create / update / delete) enough headroom.
  expect: { timeout: 15_000 },
  tsconfig: './tsconfig.playwright.json',
  globalSetup: './global-setup.ts',
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    storageState: 'playwright/.auth/user.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

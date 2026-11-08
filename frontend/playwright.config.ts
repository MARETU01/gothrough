import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5183', locale: 'zh-CN', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
  webServer: [
    { command: 'node e2e/server.mjs', url: 'http://127.0.0.1:19815/api/auth/status', timeout: 120_000, reuseExistingServer: false },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5183 --strictPort', url: 'http://127.0.0.1:5183',
      env: { GOTHROUGH_DEV_API_TARGET: 'http://127.0.0.1:19815' }, reuseExistingServer: false },
  ],
});

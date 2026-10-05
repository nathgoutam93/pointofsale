import { defineConfig, devices } from '@playwright/test';

// The smoke test: the real web app against the real API (offline mode) on an emptied
// database. `pnpm --filter @pos/web e2e`; the API must be built first.
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 3101);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `http://localhost:${apiPort}/meta`,
      timeout: 120_000,
      reuseExistingServer: false
    },
    {
      command: `pnpm exec vite --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      env: { VITE_API_BASE_URL: `http://localhost:${apiPort}` },
      timeout: 120_000,
      reuseExistingServer: false
    }
  ]
});

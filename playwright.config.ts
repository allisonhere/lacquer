import { defineConfig, devices } from '@playwright/test';
/**
 * Ports are configurable so the browser suite can run while a Compose stack
 * still holds the default 3001/5173. Without this, `reuseExistingServer` would
 * silently bind the tests to whatever is already listening — which fails in
 * confusing ways when that server belongs to a different build.
 */
const apiPort = Number(process.env.E2E_API_PORT ?? 3001);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5173);
const appUrl = `http://localhost:${webPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const serverEnv = {
  APP_URL: appUrl,
  ORIGIN: appUrl,
  API_INTERNAL_URL: apiUrl,
  API_PORT: String(apiPort),
  PORT: String(webPort),
  HOST: '127.0.0.1',
  // The whole suite runs from one address; the production default of 120/min
  // is a client-facing safety limit, not a statement about test traffic.
  RATE_LIMIT_MAX: '100000',
};
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: appUrl, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @lacquer/api start',
      url: `${apiUrl}/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: serverEnv,
    },
    {
      command: 'pnpm --filter @lacquer/web start',
      url: `${appUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: serverEnv,
    },
  ],
});

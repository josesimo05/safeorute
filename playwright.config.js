import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
      : {},
  },
  webServer: {
    command: 'npm run build -- --mode demo --outDir .pwa-test-dist && npm run preview -- --outDir .pwa-test-dist --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});

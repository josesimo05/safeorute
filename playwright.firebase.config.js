import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/firebase',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4176',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
      : {},
  },
  webServer: {
    command: 'npm run build -- --outDir .firebase-test-dist && npm run preview -- --outDir .firebase-test-dist --host 127.0.0.1 --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false,
  },
});

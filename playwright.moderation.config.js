import {defineConfig} from '@playwright/test';

// This suite renders the real moderation component in a test-only Vite entry.
// Firebase authorization and realtime delivery are tested separately by rules.
export default defineConfig({
  testDir: './tests/moderation',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    locale: 'es-DO',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
      : {},
  },
  webServer: {
    command: 'npm run dev -- --mode demo --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178/tests/moderation/fixture.html',
    reuseExistingServer: false,
  },
});

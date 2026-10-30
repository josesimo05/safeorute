import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'.', testMatch:'dashboard.spec.js', workers:1, timeout:20_000,
  use:{browserName:'chromium',viewport:{width:390,height:844},locale:'es-DO',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'}},
});

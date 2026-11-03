import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
import {itsViteProxy} from './api/its.js';
import {supportViteProxy} from './api/support.js';
import {reportsViteProxy} from './api/reports.js';
import {versionViteProxy} from './api/version.js';
import {buildRelease, releasePlugin, isolatePilotPlugin} from './build/release.js';

const release = buildRelease();

export default defineConfig({
  define: {__SAFEROUTE_RELEASE__:JSON.stringify(release)},
  build: {rolldownOptions:{input:{main:'index.html', piloto:'piloto/index.html'}}},
  plugins: [
    itsViteProxy(),
    supportViteProxy(),
    reportsViteProxy(),
    versionViteProxy(),
    react(),
    VitePWA({
      // Activate completed releases automatically. React defers the page reload
      // while a report, route, or another unfinished task is open.
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: null,
      includeAssets: ['brand-mark.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'SafeRoute',
        short_name: 'SafeRoute',
        lang: 'es',
        dir: 'ltr',
        description: 'Reportes comunitarios por zona y horario',
        theme_color: '#16324F',
        background_color: '#F5F8FA',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
          {src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
          {src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        globIgnores: ['piloto/**', 'assets/piloto-*', '**/piloto-*'],
      },
    }),
    releasePlugin(release),
    isolatePilotPlugin(),
  ],
});

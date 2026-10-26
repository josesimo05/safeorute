import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Registration and update confirmation live in the React interface.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'SafeRoute',
        short_name: 'SafeRoute',
        lang: 'es',
        dir: 'ltr',
        description: 'Reportes comunitarios por zona y horario',
        theme_color: '#194b3d',
        background_color: '#f6f7f2',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
          {src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
          {src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
        // Cache only the app shell, never map tiles or authenticated API data.
        runtimeCaching: [],
      },
    }),
  ],
});

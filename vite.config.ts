import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative Pfade: die App läuft auch unter Unterpfaden (z. B. GitHub Pages) und der Decoder findet ./wasm/ lokal.
  base: './',
  build: {
    // Offline-first: alles wird vorab gecacht, ein einziges Bundle (bwip-js ist gross) ist bewusst gewollt (ADR-33).
    chunkSizeWarningLimit: 1500
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['wasm/zxing_reader.wasm', 'icons/*'],
      manifest: false, // nutzt public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,webmanifest}'],
        // Die gemeinsame Bibliothek (library/*.json) wird NICHT vorab gecacht, sondern netzwerkbevorzugt:
        // online immer die aktuelle Version, offline die zuletzt gesehene.
        globIgnores: ['library/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => /\/library\/[^/]+\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'barq-library', networkTimeoutSeconds: 4, expiration: { maxEntries: 250 } }
          }
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
  server: {
    port: 5173
  }
});

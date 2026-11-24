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
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
  server: {
    port: 5173
  }
});

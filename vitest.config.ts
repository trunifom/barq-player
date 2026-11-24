import { defineConfig } from 'vitest/config';

// Eigene Test-Konfiguration: das PWA-Plugin aus vite.config.ts wird im Testlauf nicht benoetigt.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts']
  }
});

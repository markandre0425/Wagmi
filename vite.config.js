import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Root Vite config: builds both the landing page (/) and the Wagmi app (/app/).
 * - main entry: index.html at / → script ./landing/src/main.tsx (React landing, bundled here)
 * - app entry: app/index.html at /app/ → script ../main.js (vanilla Wagmi)
 * The landing workspace has its own vite.config.ts for running from landing/ only; root build uses this config.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        app: 'app/index.html',
      },
    },
  },
})

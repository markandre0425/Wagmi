import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Root Vite config: builds both the landing page (/) and the Wagmi app (/app/).
 * - main entry: index.html at / → script ./landing/src/main.tsx (React landing, bundled here)
 * - app entry: app/index.html at /app/ → script ../main.js (vanilla Wagmi)
 * The landing workspace has its own vite.config.ts for running from landing/ only; root build uses this config.
 *
 * For Electron builds, set ELECTRON_BUILD=1 so asset paths are relative (./)
 * instead of absolute (/), which is required for file:// protocol loading.
 */
const isElectronBuild = process.env.ELECTRON_BUILD === '1'

export default defineConfig({
  // Electron loads from file:// so assets must use relative paths
  base: isElectronBuild ? './' : '/',
  plugins: [react()],
  // Force Vite to pre-bundle WalletConnect's dynamically-imported provider.
  // Without this, @wagmi/connectors' dynamic import() of the provider fails
  // because Vite's dev server doesn't discover transitive dynamic imports.
  optimizeDeps: {
    include: [
      '@walletconnect/ethereum-provider',
    ],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Both web and Electron now build both entries so the "Back to Home"
      // link works everywhere.  The landing page (index.html) is light
      // enough that including it in the Electron bundle is negligible.
      input: { main: 'index.html', app: 'app/index.html' },
    },
  },
})

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
  // Force Vite to pre-bundle WalletConnect's dynamically-imported provider
  // AND its CJS sub-dependencies.  Without this, @wagmi/connectors' dynamic
  // import() of the provider fails because Vite's dev server doesn't discover
  // transitive dynamic imports, and the CJS-only jsonrpc / keyvaluestorage
  // packages aren't automatically converted to ESM during dev serving.
  optimizeDeps: {
    include: [
      '@walletconnect/ethereum-provider',
      // CJS sub-deps that Vite won't auto-discover behind the dynamic import
      '@walletconnect/jsonrpc-utils',
      '@walletconnect/jsonrpc-types',
      '@walletconnect/keyvaluestorage',
    ],
  },
  // Prevent duplicated WalletConnect packages when multiple versions are
  // hoisted (e.g. @wagmi/connectors and @reown/appkit both pull them in).
  resolve: {
    dedupe: [
      '@walletconnect/ethereum-provider',
      '@walletconnect/universal-provider',
      '@walletconnect/sign-client',
      '@walletconnect/core',
      '@walletconnect/utils',
      '@walletconnect/types',
    ],
  },
  build: {
    outDir: 'dist',
    // Reduce parallelism so build uses less RAM and is less likely to be "Killed" on low-memory deploy (e.g. 512MB–1GB).
    rollupOptions: {
      input: { main: 'index.html', app: 'app/index.html' },
      maxParallelFileOps: 1,
    },
  },
})

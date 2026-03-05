import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Root Vite config: builds both the landing page (/) and the Wagmi app (/app/).
 * - main entry: index.html at / → script ./landing/src/main.tsx (React landing, bundled here)
 * - app entry: app/index.html at /app/ → script ../main.js (vanilla Wagmi)
 * - In dev, /dashboard/ is served from dist/dashboard (built by WW-Dash; run dev script to build + watch).
 *
 * For Electron builds, set ELECTRON_BUILD=1 so asset paths are relative (./)
 * instead of absolute (/), which is required for file:// protocol loading.
 */
const isElectronBuild = process.env.ELECTRON_BUILD === '1'

/** In dev, serve /dashboard from dist/dashboard so landing + dashboard run on one port. */
function serveDashboardPlugin() {
  const dashboardDir = path.resolve(__dirname, 'dist', 'dashboard')
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }
  return {
    name: 'serve-dashboard',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || !req.url?.startsWith('/dashboard')) return next()
        const sub = req.url.slice('/dashboard'.length).replace(/^\//, '') || ''
        const file = path.resolve(dashboardDir, sub === '' ? 'index.html' : sub)
        const safeDir = path.resolve(dashboardDir)
        if (!file.startsWith(safeDir) || !fs.existsSync(file)) {
          if (sub === '' || sub === 'index.html') {
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html')
            res.end(`<html><body><p>Dashboard not built yet. Run <code>npm run dev</code> (it builds the dashboard first).</p></body></html>`)
            return
          }
          return next()
        }
        const stat = fs.statSync(file)
        if (stat.isDirectory()) {
          const idx = path.join(file, 'index.html')
          if (fs.existsSync(idx)) return sendFile(res, idx, path.extname(idx))
          return next()
        }
        sendFile(res, file, path.extname(file))
      })
    },
  }
  function sendFile(res, file, ext) {
    const type = mime[ext] || 'application/octet-stream'
    res.setHeader('Content-Type', type)
    fs.createReadStream(file).pipe(res)
  }
}

export default defineConfig({
  // Electron loads from file:// so assets must use relative paths
  base: isElectronBuild ? './' : '/',
  plugins: [react(), serveDashboardPlugin()],
  server: {
    // Proxy /api/ requests to the backend so Electron (which loads from
    // localhost:5173) can reach the Express server on port 3001.
    // This keeps auth cookies on the same origin and avoids cross-origin
    // SameSite=Lax cookie issues.
    // IMPORTANT: use '/api/' (trailing slash) so the proxy doesn't intercept
    // source-file imports like /api.js which also start with "/api".
    proxy: {
      '/api/': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
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

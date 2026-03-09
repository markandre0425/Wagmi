process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

import { app, BrowserWindow, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = process.env.NODE_ENV === 'development'

// ── Chromium flags (MUST come before app.whenReady()) ────────────────
//
// 1. ignore-certificate-errors
//    WalletConnect's relay (relay.walletconnect.com) and verify service
//    trigger SSL handshake failures inside Electron's Chromium,
//    preventing the WebSocket connection and QR URI generation.
//
// 2. disable-gpu-sandbox
//    Relaxes the GPU process sandbox.  Avoids "SharedImageManager" /
//    GPU-mailbox errors without killing the software rendering pipeline
//    that paints SVG content inside Shadow DOM (the AppKit QR code).
//    Do NOT use --disable-gpu (it kills the compositor entirely and
//    leaves Shadow DOM SVGs un-painted).
//
// 3. test-type
//    Suppresses Chromium's first-run / GPU-info-collection dialogs that
//    can stall the renderer in headless-like Electron builds.
//
// 4. ignore-gpu-blocklist
//    Forces hardware acceleration even if the GPU is on Chromium's
//    blocklist.  Ensures Shadow DOM SVG (QR code) is composited.
//
// 5. allow-insecure-localhost
//    Trusts localhost TLS certs during development so wss:// connections
//    to dev proxies are not rejected.
app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('test-type')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('allow-insecure-localhost')

// ── Window factory ───────────────────────────────────────────────────
// IMPORTANT: This function must NOT register session-level listeners
// (onHeadersReceived, onBeforeSendHeaders).  Those are global to the
// default session and must be registered exactly once — see the
// app.whenReady() block below.
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173/')
    // DevTools: uncomment the next line when you need the inspector.
    win.webContents.openDevTools()
  } else {
    // In production, load the landing page from the dist folder
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// ── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Clear GPU shader cache, app cache, cookies, and local storage on
  // every dev launch to prevent stale SharedImageManager / GPU errors.
  session.defaultSession.clearStorageData({
    storages: ['appcache', 'cookies', 'localstorage', 'shadercache'],
  }).catch((err) => {
    console.warn('Failed to clear session storage data:', err)
  })

  // ── Global session handlers (registered ONCE) ─────────────────────
  // These operate on session.defaultSession which is shared across all
  // BrowserWindows.  Placing them here (not inside createWindow) avoids
  // stacking duplicate listeners on macOS 'activate' reopens.

  // Inject a permissive CSP for every response so that the Reown AppKit
  // Shadow DOM SVG QR code, WalletConnect relay WebSocket, and all
  // CDN / font / image assets load without being silently blocked.
  //
  // We also DELETE 'x-webkit-csp' and 'content-security-policy-report-only'
  // because Electron/Chromium can silently enforce those as secondary CSP
  // policies, blocking wss://relay.walletconnect.org even when the main
  // CSP header allows it.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }

    // Remove any CSP-related headers that could silently block WebSockets
    delete headers['x-webkit-csp']
    delete headers['X-WebKit-CSP']
    delete headers['content-security-policy-report-only']
    delete headers['Content-Security-Policy-Report-Only']

    // Override with a maximally permissive CSP
    headers['Content-Security-Policy'] = [
      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
      "img-src * data: blob:; " +
      "connect-src * ws: wss:; " +
      "style-src * 'unsafe-inline';",
    ]

    callback({ responseHeaders: headers })
  })

  // Tag every outgoing request so the API server can identify Electron
  // clients and set SameSite=None on cookies for cross-origin requests.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['X-Electron-App'] = '1'
    callback({ requestHeaders: details.requestHeaders })
  })

  createWindow()

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ── Selectively bypass cert errors for WalletConnect domains ──────────
// Active in BOTH dev and prod.  The blanket --ignore-certificate-errors
// flag covers most cases, but this handler ensures that if that flag is
// ever removed, the WalletConnect relay / verify WebSocket connections
// still succeed (they require SSL trust for the QR URI to be generated).
const TRUSTED_WC_HOSTS = [
  'relay.walletconnect.com',
  'relay.walletconnect.org',
  'verify.walletconnect.com',
  'verify.walletconnect.org',
  'pulse.walletconnect.org',
  'keys.walletconnect.com',
  // Alchemy RPC — server-side calls don't need this, but browser-initiated
  // requests (e.g. viem publicClient from the renderer) do.
  'eth-mainnet.g.alchemy.com',
  'eth-sepolia.g.alchemy.com',
]

app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
  try {
    const { hostname } = new URL(url)
    if (TRUSTED_WC_HOSTS.includes(hostname)) {
      event.preventDefault()
      return callback(true) // trust this specific host
    }
  } catch { /* malformed URL — fall through */ }
  return callback(false) // default: reject
})

app.on('window-all-closed', () => {
  // On macOS, it's common for applications to stay open until the user explicitly quits
  if (process.platform !== 'darwin') app.quit()
})

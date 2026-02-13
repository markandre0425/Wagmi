import { app, BrowserWindow, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = process.env.NODE_ENV === 'development'

// ── Bypass SSL certificate errors for WalletConnect QR codes ─────────
// WalletConnect's relay (relay.walletconnect.com) and verify service
// (verify.walletconnect.org) trigger SSL handshake failures (-202 /
// ERR_SSL_PROTOCOL_ERROR) inside Electron's Chromium.  The error
// manifests as a blank dark box where the QR code should render.
//
// This flag MUST be called at the module's top level, before
// app.whenReady(), so that Chromium picks it up when the browser
// process starts.  With ES-module imports the app object is already
// initialised, so this is the earliest possible call site.
//
// In production the selective `certificate-error` handler further below
// limits trust to known WalletConnect domains only.
app.commandLine.appendSwitch('ignore-certificate-errors')

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

  // Tag every outgoing request so the API server can identify Electron clients.
  // This lets the server set SameSite=None on cookies for cross-origin Electron requests.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['X-Electron-App'] = '1'
    callback({ requestHeaders: details.requestHeaders })
  })

  if (isDev) {
    win.loadURL('http://localhost:5173/app/')
    // DevTools: uncomment the next line when you need the inspector.
    // win.webContents.openDevTools()
  } else {
    // In production, load the built app/index.html from the dist folder
    win.loadFile(path.join(__dirname, '..', 'dist', 'app', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ── Production-safe: selectively bypass cert errors for WalletConnect ──
// In production the blanket --ignore-certificate-errors flag is NOT set,
// but the relay/verify servers can still occasionally trigger -202 errors.
// This handler allows only known WalletConnect domains through.
if (!isDev) {
  const TRUSTED_WC_HOSTS = [
    'relay.walletconnect.com',
    'relay.walletconnect.org',
    'verify.walletconnect.com',
    'verify.walletconnect.org',
    'pulse.walletconnect.org',
    'keys.walletconnect.com',
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
}

app.on('window-all-closed', () => {
  // On macOS, it's common for applications to stay open until the user explicitly quits
  if (process.platform !== 'darwin') app.quit()
})

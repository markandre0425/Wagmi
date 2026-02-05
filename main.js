import { createConfig, connect, disconnect, getConnection, signMessage, watchConnections } from '@wagmi/core'
import { injected } from '@wagmi/connectors'
import { http } from 'viem'
import { mainnet } from 'viem/chains'

const statusEl = document.getElementById('status')
const connectBtn = document.getElementById('connect')
const disconnectBtn = document.getElementById('disconnect')
const signBtn = document.getElementById('sign')
const meBtn = document.getElementById('walletAddress')
const privateBtn = document.getElementById('private')
const logoutBtn = document.getElementById('logout')
const loginGoogleBtn = document.getElementById('loginGoogle')
const loginFacebookBtn = document.getElementById('loginFacebook')

// In production: set VITE_API_URL to your API origin, or leave unset when frontend and API are on the same host
const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3001')

const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
  connectors: [
    injected({
      target: 'metaMask',
    }),
  ],
})

// Track if user explicitly disconnected (wagmi may auto-reconnect otherwise)
let userDisconnected = false

// Log activity to backend (stored privately in a txt file on server)
async function logActivity(type, address, balance = null) {
  try {
    await fetch(`${API_BASE}/api/log-activity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type, address, balance }),
    })
  } catch {
    // Silently fail – logging is best-effort
  }
}

function render() {
  const account = getConnection(config)

  // If user clicked disconnect, treat as disconnected even if wagmi auto-reconnects
  if (userDisconnected || !account?.address) {
    statusEl.textContent = 'Not connected'
    connectBtn.disabled = false
    disconnectBtn.disabled = true
    signBtn.disabled = true
    return
  }

  statusEl.textContent = JSON.stringify(
    {
      address: account.address,
      chainId: account.chainId,
      status: account.status,
    },
    null,
    2,
  )
  connectBtn.disabled = true
  disconnectBtn.disabled = false
  signBtn.disabled = false
}


watchConnections(config, {
  onChange() {
    render()
  },
})

connectBtn.addEventListener('click', async () => {
  // Detect if any injected wallet is available (MetaMask, Binance Wallet, etc.)
  const hasInjected = typeof window !== 'undefined' && window.ethereum
  if (!hasInjected) {
    const msg = 'No Ethereum wallet detected.\nInstall MetaMask and then refresh this page.'
    statusEl.innerHTML =
      'No Ethereum wallet detected.<br />Install&nbsp;' +
      '<span style="position: relative; display: inline-block;">' +
      '<a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">MetaMask</a>' +
      '<span id="metamask-tooltip" ' +
      'style="display:none; position:absolute; left:0; top:120%; background:#333; color:#fff; padding:4px 8px; border-radius:4px; font-size:12px; white-space:nowrap; z-index:10;">' +
      'Open the official MetaMask download page' +
      '</span>' +
      '</span>' +
      '&nbsp;and then refresh this page.'

    const linkContainer = statusEl.querySelector('span > a')
    const tooltip = statusEl.querySelector('#metamask-tooltip')
    if (linkContainer && tooltip) {
      linkContainer.addEventListener('mouseover', () => {
        tooltip.style.display = 'block'
      })
      linkContainer.addEventListener('mouseout', () => {
        tooltip.style.display = 'none'
      })
    }
    alert(msg)
    return
  }

  try {
    userDisconnected = false
    await connect(config, { connector: injected({ target: 'metaMask' }) })
  } catch (err) {
    statusEl.textContent = `Connect error:\n${String(err?.message ?? err)}`
  } finally {
    render()
  }
})

disconnectBtn.addEventListener('click', async () => {
  try {
    const account = getConnection(config)
    const address = account?.address ?? 'unknown'
    await disconnect(config)
    userDisconnected = true
    logActivity('disconnect', address)
  } catch (err) {
    statusEl.textContent = `Disconnect error:\n${String(err?.message ?? err)}`
  } finally {
    render()
  }
})

signBtn.addEventListener('click', async () => {
  try {
    const account = getConnection(config)
    if (!account?.address) throw new Error('Not connected')

    const chainId = account.chainId || mainnet.id
    const uri = window.location.origin

    // Get a SIWE message from backend
    const msgRes = await fetch(
      `${API_BASE}/api/siwe/message?address=${encodeURIComponent(account.address)}&chainId=${encodeURIComponent(chainId)}&uri=${encodeURIComponent(uri)}`,
      { credentials: 'include' },
    )
    const msgJson = await msgRes.json().catch(() => ({}))
    if (!msgRes.ok || !msgJson.ok) throw new Error(msgJson.error || `SIWE message request failed: ${msgRes.status}`)
    const message = msgJson.message

    const signature = await signMessage(config, {
      account: account.address,
      message,
    })

    // Verify SIWE message + signature on backend
    const verifyRes = await fetch(`${API_BASE}/api/siwe/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message, signature }),
    })
    const verifyJson = await verifyRes.json().catch(() => ({}))
    if (!verifyRes.ok || !verifyJson.ok) {
      throw new Error(verifyJson.error || `Verify failed: ${verifyRes.status}`)
    }

    // Log successful login with balance (if available)
    logActivity('login', account.address, verifyJson.balance || null)

    statusEl.textContent = JSON.stringify(
      { ok: true, address: account.address, balance: verifyJson.balance || 'N/A', note: 'JWT stored in HttpOnly cookie.' },
      null,
      2,
    )
  } catch (err) {
    statusEl.textContent = `Sign error:\n${String(err?.message ?? err)}`
  }
})

meBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE}/api/walletAddress`, { credentials: 'include' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) throw new Error(json.error || `Request failed: ${res.status}`)
    statusEl.textContent = JSON.stringify(json, null, 2)
  } catch (err) {
    statusEl.textContent = `Me error:\n${String(err?.message ?? err)}`
  }
})

privateBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE}/api/private`, { credentials: 'include' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) throw new Error(json.error || `Request failed: ${res.status}`)
    statusEl.textContent = JSON.stringify(json, null, 2)
  } catch (err) {
    statusEl.textContent = `Private error:\n${String(err?.message ?? err)}`
  }
})

logoutBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) throw new Error(json.error || `Request failed: ${res.status}`)
    statusEl.textContent = JSON.stringify({ ok: true, loggedOut: true }, null, 2)
  } catch (err) {
    statusEl.textContent = `Logout error:\n${String(err?.message ?? err)}`
  }
})

// Social login: redirect to backend OAuth (same tab)
if (loginGoogleBtn) {
  loginGoogleBtn.addEventListener('click', () => {
    const returnTo = encodeURIComponent(window.location.origin + window.location.pathname)
    window.location.href = `${API_BASE}/api/auth/google?returnTo=${returnTo}`
  })
}
if (loginFacebookBtn) {
  loginFacebookBtn.addEventListener('click', () => {
    const returnTo = encodeURIComponent(window.location.origin + window.location.pathname)
    window.location.href = `${API_BASE}/api/auth/facebook?returnTo=${returnTo}`
  })
}

// Show auth error if we were redirected back with one
const params = new URLSearchParams(window.location.search)
const authError = params.get('auth_error')
if (authError) {
  const msg = { invalid_state: 'Invalid or expired login state.', config: 'Social login not configured.', token: 'Login failed (token).', userinfo: 'Could not load profile.' }
  statusEl.textContent = `Login error: ${msg[authError] || authError}`
  history.replaceState(null, '', window.location.pathname)
}

render()

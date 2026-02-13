import './app/app.css'
import { connect, disconnect, getConnection, signMessage, watchConnections, sendTransaction } from '@wagmi/core'
import { injected, walletConnect } from '@wagmi/connectors'
import { http, parseEther, parseUnits, formatEther, isAddress, createPublicClient, encodeFunctionData, getAddress } from 'viem'
import { mainnet as viemMainnet, sepolia as viemSepolia } from 'viem/chains'

// AppKit / Reown imports for WalletConnect support
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, sepolia } from '@reown/appkit/networks'

// Uniswap V2 Router (mainnet) for swap
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const WETH_MAINNET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const ROUTER_ABI = [
  { inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], name: 'getAmountsOut', outputs: [{ name: 'amounts', type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], name: 'swapExactETHForTokens', outputs: [{ name: 'amounts', type: 'uint256[]' }], stateMutability: 'payable', type: 'function' },
]
const ERC20_ABI = [
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
]

// Preset ERC20 tokens (mainnet). WBTC = 8 decimals, RON = 18.
const PRESET_TOKENS = {
  btc: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, symbol: 'WBTC' },
  ron: { address: '0x23f043426b2336E723B32FB3BF4A1cA410F7c49a', decimals: 18, symbol: 'RON' },
}

const statusEl = document.getElementById('status')
const connectBtn = document.getElementById('connect')
const disconnectBtn = document.getElementById('disconnect')
const signBtn = document.getElementById('sign')
const sendToInput = document.getElementById('sendToInput')
const sendAmountInput = document.getElementById('sendAmountInput')
const sendEthBtn = document.getElementById('sendEthBtn')
const sendKind = document.getElementById('sendKind')
const sendTokenPreset = document.getElementById('sendTokenPreset')
const sendTokenPresetWrap = document.getElementById('sendTokenPresetWrap')
const sendTokenAddress = document.getElementById('sendTokenAddress')
const sendKindTrigger = document.getElementById('sendKindTrigger')
const sendKindPanel = document.getElementById('sendKindPanel')
const sendTokenPresetTrigger = document.getElementById('sendTokenPresetTrigger')
const sendTokenPresetPanel = document.getElementById('sendTokenPresetPanel')
const swapToggle = document.getElementById('swapToggle')
const swapChevron = document.getElementById('swapChevron')
const swapContent = document.getElementById('swapContent')
const swapAmountInput = document.getElementById('swapAmountInput')
const swapTokenOutInput = document.getElementById('swapTokenOutInput')
const swapBtn = document.getElementById('swapBtn')
const balanceEl = document.getElementById('balanceEl')
const balanceNetworkEl = document.getElementById('balanceNetwork')
const addressEl = document.getElementById('addressEl')
const addressLine = document.getElementById('addressLine')
const addressCopyBtn = document.getElementById('addressCopyBtn')
const sendSection = document.getElementById('sendSection')
const swapSection = document.getElementById('swapSection')

// Environment detection
const IS_ELECTRON = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

// In Electron the app always talks to the deployed Railway API.
// On the web: set VITE_API_URL to your API origin, or leave unset when frontend and API are on the same host.
const API_BASE = (() => {
  if (IS_ELECTRON) {
    const url = import.meta.env.VITE_API_URL_ELECTRON
    if (!url) {
      console.warn('VITE_API_URL_ELECTRON is missing. API calls will be disabled in Electron.')
      return ''
    }
    return url
  }
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  if (import.meta.env.PROD) {
    console.warn('VITE_API_URL is missing in production. API calls will be disabled.')
    return ''
  }
  return 'http://localhost:3001'
})()

// "Back to home" link — visible in ALL environments (web + Electron).
// In Electron the landing page isn't at "/" (file:// protocol), so we
// rewrite the href to a relative path that works from app/index.html.
if (IS_ELECTRON) {
  const backLink = document.getElementById('backToHome')
  if (backLink) {
    // In dev:  localhost:5173/app/ → "../index.html" = localhost:5173/index.html ✓
    // In prod: file://…/dist/app/index.html → "../index.html" = file://…/dist/index.html ✓
    backLink.setAttribute('href', '../index.html')
  }
}

// Reown AppKit + WagmiAdapter setup
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID

// --- Wallet feature gate ---
// If projectId is missing the app still renders; only wallet actions are disabled.
let walletEnabled = false
/** @type {ReturnType<typeof import('@reown/appkit-adapter-wagmi').WagmiAdapter['prototype']['wagmiConfig']> | null} */
let config = null
/** @type {ReturnType<typeof createAppKit> | null} */
let appKitModal = null

// ── Singleton guard ───────────────────────────────────────────────
// WalletConnect Core throws "Init() was called 2 times" if
// createAppKit / WagmiAdapter run more than once (React Strict Mode,
// Vite HMR, or Electron hot-reloads).
//
// globalThis._WAGMI_INITIALIZED is checked first.  If the flag is
// set, we reuse the previously created instances and skip the entire
// init block.  Using globalThis (instead of window) makes the guard
// resilient to module re-execution in any JS environment.
if (globalThis._WAGMI_INITIALIZED) {
  config = globalThis._wagmiConfig ?? null
  appKitModal = globalThis._appKitModal ?? null
  walletEnabled = !!config
  console.info('[wagmi] Skipping duplicate init — reusing existing instances.')
} else if (!projectId) {
  console.warn('VITE_REOWN_PROJECT_ID is missing. Wallet features are disabled.')
  if (connectBtn) {
    connectBtn.disabled = true
    connectBtn.textContent = 'Connect (Project ID missing)'
  }
  if (statusEl) statusEl.textContent = 'Wallet features disabled (Project ID missing).'
} else {
  // Mark BEFORE doing any work so that a partial failure (Core inits
  // but createAppKit throws) still prevents a second attempt from
  // hitting the "already initialized" error.
  globalThis._WAGMI_INITIALIZED = true

  const metadata = {
    name: 'Wealth Wards',
    description: 'Wealth Wards – Desktop & Web3 App',
    url: IS_ELECTRON
      ? (import.meta.env.VITE_DAPP_URL ?? 'https://wealthwards.app')
      : window.location.origin,
    icons: [
      'https://wealthwards.app/favicon.ico',
      { Author: "Mark Andre Steup" },
    ],
  }

  // Bifurcated connectors:
  //  • Web  → injected() (MetaMask / browser extension) + walletConnect()
  //  • Electron → walletConnect() only (no browser extensions available)
  const connectors = IS_ELECTRON
    ? [walletConnect({ projectId, metadata, showQrModal: false })]
    : [injected(), walletConnect({ projectId, metadata, showQrModal: false })]

  const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks: [mainnet, sepolia],
    connectors,
  })

  appKitModal = createAppKit({
    adapters: [wagmiAdapter],
    networks: [mainnet, sepolia],
    metadata,
    projectId,
    features: { analytics: false },
  })

  config = wagmiAdapter.wagmiConfig
  walletEnabled = true

  // Persist on globalThis so subsequent loads (HMR / double-render) skip init
  globalThis._wagmiConfig = config
  globalThis._appKitModal = appKitModal
}

// Track if user explicitly disconnected (even if wagmi auto-reconnect)
let userDisconnected = false

// Helper to resolve chain based on chainId
function getViemChain(chainId) {
  if (chainId === viemMainnet.id) return viemMainnet;
  if (chainId === viemSepolia.id) return viemSepolia;
  // Return null for unsupported chains to prevent silent transaction failures
  return null;
}

// Fetch native (ETH) balance for the current chain and show in UI
async function updateBalance(account) {
  if (!balanceEl || !account?.address) return
  const chainId = Number(account.chainId ?? viemMainnet.id)
  const chain = getViemChain(chainId)
  if (!chain) {
    balanceEl.textContent = 'Unsupported network';
    if (balanceNetworkEl) {
      balanceNetworkEl.textContent = 'Unsupported network';
      balanceNetworkEl.setAttribute('aria-hidden', 'false');
    }
    return;
  }
  if (balanceNetworkEl) {
    balanceNetworkEl.textContent = chain.name ?? `Chain ${chainId}`
    balanceNetworkEl.setAttribute('aria-hidden', 'false')
  }
  try {
    const client = createPublicClient({ chain, transport: http() })
    const balance = await client.getBalance({ address: account.address })
    balanceEl.textContent = `${formatEther(balance)} ETH`
  } catch {
    balanceEl.textContent = '—'
    if (balanceNetworkEl) {
      balanceNetworkEl.textContent = ''
      balanceNetworkEl.setAttribute('aria-hidden', 'true')
    }
  }
}

// Log activity to backend (login/disconnect only). data: { balance?, chainId?, connectorName? }
async function logActivity(type, address, data = {}) {
  if (!API_BASE) return // API not configured; skip logging
  const payload = typeof data === 'object' && data !== null
    ? { type, address, ...data }
    : { type, address, balance: data }
  try {
    await fetch(`${API_BASE}/api/log-activity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
  } catch {
    // Silently fail – logging is best-effort
  }
}

// Log transaction to backend (MongoDB TransactionLog). Requires auth (JWT).
// payload: { type: 'Send'|'Swap'|'Receive'|'Buy', chainId, txHash, fromAddress?, toAddress?, amountEth?, kind?, tokenAddress?, tokenAmount?, connectorName? }
async function logTransaction(payload) {
  if (!API_BASE) return // API not configured; skip logging
  try {
    await fetch(`${API_BASE}/api/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
  } catch {
    // Silently fail – transaction logging is best-effort
  }
}

function render() {
  // If wallet features are disabled, show disconnected state and bail
  if (!walletEnabled || !config) {
    if (statusEl) {
      statusEl.classList.remove('app-status--connected')
      statusEl.classList.add('app-status--disconnected')
      if (!statusEl.textContent || statusEl.textContent === '…') {
        statusEl.textContent = 'Wallet features disabled.'
      }
    }
    if (connectBtn) connectBtn.disabled = true
    if (disconnectBtn) disconnectBtn.disabled = true
    if (signBtn) signBtn.disabled = true
    if (sendEthBtn) sendEthBtn.disabled = true
    if (swapBtn) swapBtn.disabled = true
    if (balanceEl) balanceEl.textContent = '—'
    if (balanceNetworkEl) balanceNetworkEl.textContent = ''
    if (addressEl) { addressEl.textContent = '—'; addressEl.title = '' }
    if (addressLine) { addressLine.removeAttribute('data-has-address'); addressLine.removeAttribute('data-address') }
    if (sendSection) sendSection.style.display = 'none'
    if (swapSection) swapSection.style.display = 'none'
    return
  }

  const account = getConnection(config)

  // If user clicked disconnect, treat as disconnected even if wagmi auto-reconnects
  if (userDisconnected || !account?.address) {
    statusEl.classList.remove('app-status--connected')
    statusEl.classList.add('app-status--disconnected')
    statusEl.textContent = 'Not connected'
    connectBtn.disabled = false
    disconnectBtn.disabled = true
    signBtn.disabled = true
    if (sendEthBtn) sendEthBtn.disabled = true
    if (swapBtn) swapBtn.disabled = true
    if (balanceEl) balanceEl.textContent = '—'
    if (balanceNetworkEl) balanceNetworkEl.textContent = ''
    if (addressEl) addressEl.textContent = '—'
    if (addressEl) addressEl.title = ''
    if (addressLine) addressLine.removeAttribute('data-has-address')
    if (addressLine) addressLine.removeAttribute('data-address')
    if (sendSection) sendSection.style.display = 'none'
    if (swapSection) swapSection.style.display = 'none'
    return
  }

  if (sendSection) sendSection.style.display = ''
  if (swapSection) swapSection.style.display = ''
  if (sendEthBtn) sendEthBtn.disabled = false
  if (swapBtn) swapBtn.disabled = false
  if (balanceEl) balanceEl.textContent = '…'
  if (addressEl && addressLine) {
    const addr = account.address
    addressEl.textContent = `${addr.slice(0, 6)}…${addr.slice(-4)}`
    addressEl.title = addr
    addressLine.setAttribute('data-has-address', '')
    addressLine.setAttribute('data-address', addr)
  }
  statusEl.classList.remove('app-status--disconnected')
  statusEl.classList.add('app-status--connected')
  connectBtn.disabled = true
  disconnectBtn.disabled = false
  signBtn.disabled = false
  updateBalance(account)
}


// Shared SIWE sign-in flow
async function doSiweSignIn() {
  if (!walletEnabled || !config) throw new Error('Wallet features are not available')
  if (!API_BASE) throw new Error('API is not configured')
  const account = getConnection(config)
  if (!account?.address) throw new Error('Not connected')

  const chainId = Number(account.chainId ?? viemMainnet.id)
  // In Electron, window.location.origin is "file://" which isn't valid for SIWE.
  // Use the API server origin so the SIWE domain/uri match the server's WEB_ORIGIN.
  const uri = IS_ELECTRON ? API_BASE : window.location.origin

  const msgRes = await fetch(
    `${API_BASE}/api/siwe/message?address=${encodeURIComponent(account.address)}&chainId=${chainId}&uri=${encodeURIComponent(uri)}`,
    { credentials: 'include' },
  )
  const msgJson = await msgRes.json().catch(() => ({}))
  if (!msgRes.ok || !msgJson.ok) throw new Error(msgJson.error || `SIWE message request failed: ${msgRes.status}`)
  const message = msgJson.message

  const signature = await signMessage(config, {
    account: account.address,
    message,
  })

  const verifyRes = await fetch(`${API_BASE}/api/siwe/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message, signature }),
  })
  const verifyJson = await verifyRes.json().catch(() => ({}))
  if (!verifyRes.ok || !verifyJson.ok) throw new Error(verifyJson.error || `Verify failed: ${verifyRes.status}`)

  await logActivity('login', account.address, {
    balance: verifyJson.balance ?? null,
    // Log the same chainId that was used for the SIWE message(if the user switches chains mid-flow)
    chainId,
    connectorName: account.connector?.name ?? null,
  })

  statusEl.classList.remove('app-status--disconnected')
  statusEl.classList.add('app-status--connected')
  statusEl.textContent = 'Signed in.'
}

if (walletEnabled && config) {
  watchConnections(config, {
    onChange() {
      render()
    },
  })

  // Sync UI and backend when user switches account in MetaMask
  // (Only relevant in web environments where window.ethereum exists)
  if (!IS_ELECTRON && typeof window !== 'undefined' && window.ethereum) {
    window.ethereum.on('accountsChanged', () => {
      // Defer so wagmi can update connection state first
      setTimeout(() => {
        render()
        const account = getConnection(config)
        if (account?.address && !userDisconnected) {
          statusEl.textContent = 'Account changed. Signing in with new account...'
          doSiweSignIn().then(() => {}).catch(() => {
            statusEl.textContent = 'Account changed. Click "Sign-in (message)" to link this account.'
          })
        }
      }, 0)
    })
  }
}

async function copyAddressToClipboard() {
  const addr = addressLine?.dataset?.address
  if (!addr) return
  try {
    await navigator.clipboard.writeText(addr)
    if (addressCopyBtn) {
      addressCopyBtn.textContent = 'Copied!'
      addressCopyBtn.classList.add('copied')
      setTimeout(() => {
        addressCopyBtn.textContent = 'Copy'
        addressCopyBtn.classList.remove('copied')
      }, 2000)
    }
    return true
  } catch {
    if (statusEl) statusEl.textContent = 'Could not copy to clipboard.'
    return false
  }
}

if (addressCopyBtn) addressCopyBtn.addEventListener('click', copyAddressToClipboard)

if (addressEl) {
  addressEl.addEventListener('click', () => {
    if (addressLine?.hasAttribute('data-has-address')) copyAddressToClipboard()
  })
}

connectBtn.addEventListener('click', async () => {
  if (!walletEnabled || !config || !appKitModal) {
    if (statusEl) statusEl.textContent = 'Wallet features are not available. Check your project configuration.'
    return
  }

  // In Electron there are no browser extensions → always use the AppKit modal (WalletConnect QR).
  if (IS_ELECTRON) {
    try {
      userDisconnected = false
      statusEl.textContent = 'Opening WalletConnect...'
      await appKitModal.open()          // Opens the Reown modal (QR code)
      // AppKit modal handles connection asynchronously; watchConnections will call render()
    } catch (err) {
      statusEl.textContent = `WalletConnect error:\n${String(err?.message ?? err)}`
    }
    return
  }

  // --- Web flow: prefer injected wallet, fallback to AppKit modal ---
  const hasInjected = typeof window !== 'undefined' && window.ethereum
  if (!hasInjected) {
    // No injected wallet → open AppKit modal for WalletConnect
    try {
      userDisconnected = false
      statusEl.textContent = 'Opening WalletConnect...'
      await appKitModal.open()
    } catch (err) {
      statusEl.textContent = `WalletConnect error:\n${String(err?.message ?? err)}`
    }
    return
  }

  try {
    userDisconnected = false

    // Prefer an injected connector (MetaMask or similar); fall back to first connector
    const connector =
      config.connectors.find((c) => c.id === 'injected' || c.type === 'injected') ?? config.connectors[0]
    await connect(config, { connector })
    render()

    // Auto sign-in with SIWE after connect (one click: connect + sign message)
    statusEl.textContent = 'Signing in...'
    try {
      await doSiweSignIn()
    } catch (err) {
      statusEl.textContent = `Connected. Sign-in skipped or failed:\n${String(err?.message ?? err)}`
    }
  } catch (err) {
    statusEl.textContent = `Connect error:\n${String(err?.message ?? err)}`
  } finally {
    render()
  }
})

disconnectBtn.addEventListener('click', async () => {
  if (!walletEnabled || !config) return
  try {
    const account = getConnection(config)
    const address = account?.address ?? 'unknown'
    const extra = {
      chainId: account?.chainId ?? null,
      connectorName: account?.connector?.name ?? null,
    }
    // Log disconnect while JWT is still present (log-activity requires auth)
    await logActivity('disconnect', address, extra)
    // Clear backend session (JWT cookie) so user is fully signed out
    if (API_BASE) {
      try {
        await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' })
      } catch (_) {
        // Best-effort; continue with wallet disconnect
      }
    }
    // Revoke wallet connection in MetaMask (EIP-2255) so the site is removed from Connected sites
    const provider = typeof window !== 'undefined' && window.ethereum
    if (provider?.request) {
      try {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        })
      } catch (_) {
        // If wallet not supported, wallet_revokePermissions; continue with app disconnect
      }
    }
    await disconnect(config)
    userDisconnected = true
    window.location.reload()
  } catch (err) {
    statusEl.textContent = `Disconnect error:\n${String(err?.message ?? err)}`
  } finally {
    // If i hit an error before reload(), ensure UI reflects the latest connection state
    try {
      render()
    } catch {
      // Ignore render errors during teardown / reload
    }
  }
})

signBtn.addEventListener('click', async () => {
  if (!walletEnabled || !config) return
  try {
    await doSiweSignIn()
  } catch (err) {
    statusEl.textContent = `Sign error:\n${String(err?.message ?? err)}`
  } finally {
    render()
  }
})

if (sendKind && sendTokenPreset && sendTokenAddress) {
  function updateTokenUi() {
    const isToken = sendKind.value === 'token'
    if (sendTokenPresetWrap) sendTokenPresetWrap.style.display = isToken ? 'block' : 'none'
    const preset = sendTokenPreset.value
    sendTokenAddress.style.display = isToken && preset === 'custom' ? 'block' : 'none'
    if (isToken && preset !== 'custom') sendTokenAddress.value = ''
  }
  sendKind.addEventListener('change', updateTokenUi)
  sendTokenPreset.addEventListener('change', () => {
    const preset = sendTokenPreset.value
    sendTokenAddress.style.display = preset === 'custom' ? 'block' : 'none'
    if (preset === 'btc') sendTokenAddress.value = PRESET_TOKENS.btc.address
    else if (preset === 'ron') sendTokenAddress.value = PRESET_TOKENS.ron.address
    else sendTokenAddress.value = ''
  })
  updateTokenUi()
}

function positionDropdownPanel(trigger, panel) {
  if (!trigger || !panel) return
  // Let CSS control placement; only ensure a min-width
  const width = Math.max(trigger.offsetWidth || 0, 160)
  panel.style.minWidth = `${width}px`
}

function closeAllDropdowns() {
  if (sendKindPanel) { sendKindPanel.setAttribute('aria-hidden', 'true'); sendKindTrigger?.setAttribute('aria-expanded', 'false') }
  if (sendTokenPresetPanel) { sendTokenPresetPanel.setAttribute('aria-hidden', 'true'); sendTokenPresetTrigger?.setAttribute('aria-expanded', 'false') }
}

if (sendKindTrigger && sendKindPanel && sendKind) {
  sendKindTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = sendKindPanel.getAttribute('aria-hidden') !== 'true'
    closeAllDropdowns()
    if (!open) {
      sendKindPanel.setAttribute('aria-hidden', 'false')
      sendKindTrigger.setAttribute('aria-expanded', 'true')
      positionDropdownPanel(sendKindTrigger, sendKindPanel)
    }
  })
  sendKindPanel.querySelectorAll('.app-dropdown-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      const v = opt.getAttribute('data-value')
      sendKind.value = v
      sendKindTrigger.textContent = opt.textContent
      sendKindPanel.setAttribute('aria-hidden', 'true')
      sendKindTrigger.setAttribute('aria-expanded', 'false')
      sendKind.dispatchEvent(new Event('change', { bubbles: true }))
    })
  })
}

if (sendTokenPresetTrigger && sendTokenPresetPanel && sendTokenPreset) {
  sendTokenPresetTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = sendTokenPresetPanel.getAttribute('aria-hidden') !== 'true'
    closeAllDropdowns()
    if (!open) {
      sendTokenPresetPanel.setAttribute('aria-hidden', 'false')
      sendTokenPresetTrigger.setAttribute('aria-expanded', 'true')
      positionDropdownPanel(sendTokenPresetTrigger, sendTokenPresetPanel)
    }
  })
  sendTokenPresetPanel.querySelectorAll('.app-dropdown-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      const v = opt.getAttribute('data-value')
      sendTokenPreset.value = v
      sendTokenPresetTrigger.textContent = opt.textContent
      sendTokenPresetPanel.setAttribute('aria-hidden', 'true')
      sendTokenPresetTrigger.setAttribute('aria-expanded', 'false')
      sendTokenPreset.dispatchEvent(new Event('change', { bubbles: true }))
    })
  })
}

document.addEventListener('click', closeAllDropdowns)
document.addEventListener('scroll', closeAllDropdowns, true)
// Reposition dropdowns on window resize if they're open
window.addEventListener('resize', () => {
  if (sendKindPanel && sendKindPanel.getAttribute('aria-hidden') !== 'true') {
    positionDropdownPanel(sendKindTrigger, sendKindPanel)
  }
  if (sendTokenPresetPanel && sendTokenPresetPanel.getAttribute('aria-hidden') !== 'true') {
    positionDropdownPanel(sendTokenPresetTrigger, sendTokenPresetPanel)
  }
})

// Sync trigger labels from selects on load
if (sendKindTrigger && sendKind) {
  const kindOpt = sendKind.options[sendKind.selectedIndex]
  if (kindOpt) sendKindTrigger.textContent = kindOpt.textContent
}
if (sendTokenPresetTrigger && sendTokenPreset) {
  const presetOpt = sendTokenPreset.options[sendTokenPreset.selectedIndex]
  if (presetOpt) sendTokenPresetTrigger.textContent = presetOpt.textContent
}

if (sendEthBtn && sendToInput && sendAmountInput) {
  sendEthBtn.addEventListener('click', async () => {
    if (!walletEnabled || !config) {
      if (statusEl) statusEl.textContent = 'Wallet features are not available.'
      return
    }
    const account = getConnection(config)
    if (!account?.address) {
      statusEl.textContent = 'Connect your wallet first.'
      return
    }
    const to = sendToInput.value?.trim()
    const amountStr = sendAmountInput.value?.trim()
    const isToken = sendKind?.value === 'token'
    const preset = sendTokenPreset?.value
    let tokenAddress = sendTokenAddress?.value?.trim()
    let tokenDecimals = 18
    if (isToken && (preset === 'btc' || preset === 'ron')) {
      const p = PRESET_TOKENS[preset]
      tokenAddress = p.address
      tokenDecimals = p.decimals
    }

    if (!to || !isAddress(to)) {
      statusEl.textContent = 'Enter a valid recipient address (0x...).'
      return
    }
    if (!amountStr || Number.isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
      statusEl.textContent = 'Enter a valid amount.'
      return
    }
    if (isToken && (!tokenAddress || !isAddress(tokenAddress))) {
      statusEl.textContent = 'Select a token (BTC/RON) or enter a valid token contract address.'
      return
    }
    try {
      // Normalize chainId to a number for consistent comparisons and sendTransaction API
      const chainId = Number(account.chainId ?? viemMainnet.id)
      if (isToken && (preset === 'custom' || (!preset && tokenAddress))) {
        const chain = getViemChain(chainId)
        if (!chain) {
          statusEl.textContent = 'Unsupported network. Custom token sends are only supported on Ethereum Mainnet or Sepolia in this app.';
          return;
        }
        try {
          const client = createPublicClient({ chain, transport: http() })
          const decimals = await client.readContract({
            address: /** @type {`0x${string}`} */ (tokenAddress),
            abi: ERC20_ABI,
            functionName: 'decimals',
          })
          tokenDecimals = Number(decimals)
        } catch (err) {
          statusEl.textContent = `Could not read token decimals: ${String(err?.message ?? err)}`
          return
        }
      }
      statusEl.textContent = 'Confirm in your wallet...'
      let hash
      if (isToken) {
        const amountWei = parseUnits(amountStr, tokenDecimals)
        const data = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [getAddress(to), amountWei],
        })
        ;({ hash } = await sendTransaction(config, {
          to: /** @type {`0x${string}`} */ (tokenAddress),
          data,
          value: 0n,
          chainId,
          account: account.address,
        }))
        await logTransaction({
          type: 'Send',
          chainId,
          txHash: hash,
          fromAddress: account.address,
          toAddress: to,
          kind: 'token',
          tokenAddress,
          tokenAmount: amountStr,
          connectorName: account.connector?.name ?? null,
        })
      } else {
        const value = parseEther(amountStr)
        ;({ hash } = await sendTransaction(config, {
          to: /** @type {`0x${string}`} */ (to),
          value,
          chainId,
          account: account.address,
        }))
        await logTransaction({
          type: 'Send',
          chainId,
          txHash: hash,
          fromAddress: account.address,
          toAddress: to,
          amountEth: amountStr,
          connectorName: account.connector?.name ?? null,
        })
      }
      statusEl.textContent = `Sent. Tx: ${hash}\nLogged to transactions (MongoDB if enabled).`
      sendToInput.value = ''
      sendAmountInput.value = ''
      if (sendTokenAddress) sendTokenAddress.value = ''
    } catch (err) {
      statusEl.textContent = `Send error:\n${String(err?.message ?? err)}`
    }
  })
}

if (swapToggle && swapChevron && swapContent) {
  swapToggle.addEventListener('click', () => {
    const isHidden = swapContent.style.display === 'none'
    swapContent.style.display = isHidden ? '' : 'none'
    swapChevron.textContent = isHidden ? '▼' : '▶'
  })
}
if (swapBtn && swapAmountInput && swapTokenOutInput) {
  swapBtn.addEventListener('click', async () => {
    if (!walletEnabled || !config) {
      if (statusEl) statusEl.textContent = 'Wallet features are not available.'
      return
    }
    const account = getConnection(config)
    if (!account?.address) {
      statusEl.textContent = 'Connect your wallet first.'
      return
    }
    const chainId = Number(account.chainId ?? viemMainnet.id)
    if (chainId !== viemMainnet.id) {
      statusEl.textContent = 'Swap is available on mainnet only. Switch to Ethereum Mainnet in your wallet.'
      return
    }
    const amountStr = swapAmountInput.value?.trim()
    const tokenOut = swapTokenOutInput.value?.trim()
    if (!amountStr || Number.isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
      statusEl.textContent = 'Enter a valid ETH amount.'
      return
    }
    if (!tokenOut || !isAddress(tokenOut)) {
      statusEl.textContent = 'Enter a valid token address (out).'
      return
    }
    try {
      const amountIn = parseEther(amountStr)
      const routerAddress = getAddress(UNISWAP_V2_ROUTER)
      const wethAddress = getAddress(WETH_MAINNET)
      const path = [wethAddress, getAddress(tokenOut)]
      const publicClient = createPublicClient({ chain: viemMainnet, transport: http() })
      const amounts = await publicClient.readContract({
        address: routerAddress,
        abi: ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [amountIn, path],
      })
      const amountOut = amounts[1]
      const amountOutMin = (amountOut * 99n) / 100n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
      const data = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [amountOutMin, path, getAddress(account.address), deadline],
      })
      statusEl.textContent = 'Confirm swap in your wallet...'
      const { hash } = await sendTransaction(config, {
        to: routerAddress,
        value: amountIn,
        data,
        chainId: viemMainnet.id,
        account: account.address,
      })
      await logTransaction({
        type: 'Swap',
        chainId: viemMainnet.id,
        txHash: hash,
        fromAddress: account.address,
        toAddress: routerAddress,
        amountEth: amountStr,
        kind: 'swap',
        tokenAddress: tokenOut,
        connectorName: account.connector?.name ?? null,
      })
      statusEl.textContent = `Swap submitted. Tx: ${hash}\nLogged to transactions (MongoDB if enabled).`
      swapAmountInput.value = ''
      swapTokenOutInput.value = ''
    } catch (err) {
      statusEl.textContent = `Swap error:\n${String(err?.message ?? err)}`
    }
  })
}

render()

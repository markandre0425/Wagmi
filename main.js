
import './app/app.css'
import { connect, disconnect, reconnect, getConnection, signMessage, watchConnections, watchChainId, sendTransaction } from '@wagmi/core'
import { injected } from '@wagmi/connectors'
import { http, parseEther, parseUnits, formatEther, formatUnits, isAddress, createPublicClient, encodeFunctionData, getAddress } from 'viem'
import { mainnet as viemMainnet, sepolia as viemSepolia } from 'viem/chains'

// ── Singleton Wagmi config ───────────────────────────────────────────
// Standard @wagmi/core configuration lives in web3-config.js.
// Uses the injected connector (MetaMask / browser extension).
import { config, walletEnabled, IS_ELECTRON, appKitModal } from './web3-config.js'

//  Startup diagnost — which env am I in?
console.info(`[main.js] 🚀 App startup:`, {
  isElectron: IS_ELECTRON,
  walletEnabled,
  walletMethod: IS_ELECTRON ? 'Reown AppKit (WalletConnect QR)' : 'Injected Connector (MetaMask)',
  appKitModalReady: !!appKitModal,
})

// ── API utilities for session, balance, assets, and profile ──────────
import {
  getWalletSession,
  getProfileFromBackend,
  saveProfileToBackend
} from './api.js'

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
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
]

// Preset ERC20 tokens (mainnet). WBTC = 8 decimals, others = 18.
const PRESET_TOKENS = {
  btc: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, symbol: 'WBTC' },
  ron: { address: '0x23f043426b2336E723B32FB3BF4A1cA410F7c49a', decimals: 18, symbol: 'RON' },
  cscs: { address: '0xa6Ec49E06C25F63292bac1Abc1896451A0f4cFB7', decimals: 18, symbol: 'CSCS' },
  cscr: { address: '0x9C9580A8915d2797fb9E9651c93aE1559D8A498e', decimals: 18, symbol: 'CSCR' },
}

// Custom tokens that MUST always appear in the asset dashboard.
// If Alchemy's getTokenBalances doesn't return them, the backend
// performs a targeted fallback fetch for each contract.
const PINNED_TOKENS = [
  { address: '0xa6Ec49E06C25F63292bac1Abc1896451A0f4cFB7', symbol: 'CSCS', name: 'CSCS Token', chainId: 1 },
  { address: '0x9C9580A8915d2797fb9E9651c93aE1559D8A498e', symbol: 'CSCR', name: 'CSCR Token', chainId: 1 },
]

const statusEl = document.getElementById('status')
const connectBtn = document.getElementById('connect')
const disconnectBtn = document.getElementById('disconnect')
const signBtn = document.getElementById('sign')
const sendToInput = document.getElementById('sendToInput')
const sendAmountInput = document.getElementById('sendAmountInput')
const sendEthBtn = document.getElementById('sendEthBtn')
const sendAsset = document.getElementById('sendAsset')
const sendTokenAddress = document.getElementById('sendTokenAddress')
const sendAssetTrigger = document.getElementById('sendAssetTrigger')
const sendAssetPanel = document.getElementById('sendAssetPanel')
const swapToggle = document.getElementById('swapToggle')
const swapChevron = document.getElementById('swapChevron')
const swapContent = document.getElementById('swapContent')
const swapAmountInput = document.getElementById('swapAmountInput')
const swapTokenOutInput = document.getElementById('swapTokenOutInput')
const swapBtn = document.getElementById('swapBtn')
const balanceEl = document.getElementById('balanceEl')
const balanceNetworkEl = document.getElementById('balanceNetwork')
const sendSection = document.getElementById('sendSection')
const swapSection = document.getElementById('swapSection')
const assetsSection = document.getElementById('assetsSection')
const assetsGrid = document.getElementById('assetsGrid')
const assetsCount = document.getElementById('assetsCount')
const assetsLoading = document.getElementById('assetsLoading')
const assetsEmpty = document.getElementById('assetsEmpty')
const switchWalletBtn = document.getElementById('switchWalletBtn')
const walletBanner = document.getElementById('walletBanner')
const bannerNetwork = document.getElementById('bannerNetwork')
const bannerDot = document.getElementById('bannerDot')
const bannerAddress = document.getElementById('bannerAddress')
const unsupportedOverlay = document.getElementById('unsupportedOverlay')

// Profile-related elements
const profileSection = document.getElementById('profileSection')
const profileAvatar = document.getElementById('profileAvatar')
const profileDisplayName = document.getElementById('profileDisplayName')
const profileEmail = document.getElementById('profileEmail')
const profileBio = document.getElementById('profileBio')
const editProfileBtn = document.getElementById('editProfileBtn')
const profileEditModal = document.getElementById('profileEditModal')
const profileEditNameInput = document.getElementById('profileEditNameInput')
const profileEditEmailInput = document.getElementById('profileEditEmailInput')
const profileEditBioInput = document.getElementById('profileEditBioInput')
// const profileEditAvatarBtn = document.getElementById('profileEditAvatarBtn')
const profileSaveBtn = document.getElementById('profileSaveBtn')
const profileCancelBtn = document.getElementById('profileCancelBtn')

// In Electron the app always talks to the deployed Railway API.
// On the web: set VITE_API_URL to your API origin, or leave unset when frontend and API are on the same host.
// API_BASE can be '' for same-origin requests (Vite proxy in dev, or same-host prod).
// API_ENABLED distinguishes "same-origin" from "truly disabled".
let API_ENABLED = true
const API_BASE = (() => {
  if (IS_ELECTRON) {
    const url = import.meta.env.VITE_API_URL_ELECTRON
    // When empty, API calls use same-origin (works with Vite proxy in dev, same host in prod)
    return url || ''
  }
  // Web: check VITE_API_URL_WEB first, then generic VITE_API_URL
  const webUrl = import.meta.env.VITE_API_URL_WEB || import.meta.env.VITE_API_URL
  if (webUrl) return webUrl
  if (import.meta.env.PROD) {
    console.warn('VITE_API_URL_WEB is missing in production. API calls will be disabled.')
    API_ENABLED = false
    return ''
  }
  // Dev: same-origin via Vite proxy — matches Electron dev behaviour
  return ''
})()

// Helper: Build fetch headers for API calls
// For POST: include content-type and x-electron-app header
// For GET: only include x-electron-app header (GET shouldn't have content-type)
function getApiHeaders(isPost = false) {
  const headers = {}
  if (IS_ELECTRON) headers['x-electron-app'] = '1'
  if (isPost) headers['content-type'] = 'application/json'
  return headers
}

// Optional post-login redirect target (e.g. /app/?connect=1&next=/dashboard/).
// Only allow same-origin absolute paths to avoid open redirect issues.
function getSafeNextPath() {
  const params = new URLSearchParams(window.location.search)
  const next = params.get('next')
  if (!next) return null
  if (!next.startsWith('/') || next.startsWith('//')) return null
  return next
}

function redirectAfterLoginIfNeeded() {
  const nextPath = getSafeNextPath()
  if (!nextPath) return
  window.location.assign(nextPath)
}

// "Back to home" link — visible in ALL environments (web + Electron).
// In Electron the landing page isn't at "/" (file:// protocol), so we
// rewrite the href to a relative path that works from app/index.html.
if (IS_ELECTRON) {
  const backLink = document.getElementById('backToHome')
  if (backLink) {
    // In dev:  localhost:5173/app/ → "../index.html" = localhost:5173/index.html
    // In prod: file://…/dist/app/index.html → "../index.html" = file://…/dist/index.html
    backLink.setAttribute('href', '../index.html')
  }
}

// If projectId was missing, web3-config.js already logged a warning.
// Disable the connect button in that case.
if (!walletEnabled) {
  if (connectBtn) {
    connectBtn.disabled = true
    connectBtn.textContent = 'Connect (unavailable)'
  }
  if (statusEl) statusEl.textContent = 'Wallet features disabled (config failed to initialise).'
}

// In Electron, the connect flow uses AppKit (WalletConnect QR + external wallets),
// not MetaMask directly. Update the button label to reflect this.
if (IS_ELECTRON && connectBtn && walletEnabled) {
  connectBtn.textContent = 'Connect Wallet'
}

// Default to true so the UI shows "Not connected" on page load.
// Wagmi's reconnectOnMount may restore a stale session automatically;
// this flag ensures the user must explicitly click "Connect MetaMask".
let userDisconnected = true

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
  } catch (err) {
    console.error('Balance fetch failed:', err)
    balanceEl.textContent = '—'
    if (balanceNetworkEl) {
      balanceNetworkEl.textContent = ''
      balanceNetworkEl.setAttribute('aria-hidden', 'true')
    }
  }
}

// Fetch ERC-20 token assets from the backend and render in the dashboard
let assetsFetchController = null
// Fetch token balances from Moralis (via local backend proxy)
async function fetchMoralisTokens(address, chainId, controller) {
  const url = `${API_BASE}/api/tokens?address=${encodeURIComponent(address)}&chainId=${chainId}`
  const response = await fetch(url, { credentials: 'include', signal: controller.signal, headers: getApiHeaders() })

  if (!response.ok) {
    console.warn(`Moralis endpoint returned HTTP ${response.status}`)
    return null
  }

  const data = await response.json().catch(() => null)
  if (!data?.ok) {
    console.warn('Moralis response invalid:', data?.error)
    return null
  }

  // Transform Moralis tokens to match assets format
  return {
    ok: true,
    assets: (data.tokens ?? []).map(token => ({
      contractAddress: token.token_address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      balance: token.balance,
      logo: token.thumbnail,
    }))
  }
}

// When backend returns 503 (no MORALIS/ALCHEMY/ETHERSCAN keys), fetch pinned token balances via public RPC
const PINNED_FALLBACK_TOKENS = [
  { contractAddress: '0xa6Ec49E06C25F63292bac1Abc1896451A0f4cFB7', symbol: 'CSCS', name: 'CSCS Token', decimals: 18 },
  { contractAddress: '0x9C9580A8915d2797fb9E9651c93aE1559D8A498e', symbol: 'CSCR', name: 'CSCR Token', decimals: 18 },
]
async function fetchPinnedBalancesViaRpc(address, chainId, controller) {
  const chain = getViemChain(chainId)
  if (!chain) return null
  const client = createPublicClient({ chain, transport: http() })
  const assets = []
  for (const token of PINNED_FALLBACK_TOKENS) {
    if (controller.signal.aborted) return null
    try {
      const raw = await client.readContract({
        address: getAddress(token.contractAddress),
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [getAddress(address)],
      })
      const decimals = Number(token.decimals ?? 18)
      const balance = formatUnits(raw, decimals)
      assets.push({ ...token, balance, logo: null })
    } catch (e) {
      assets.push({ ...token, balance: '0', logo: null })
    }
  }
  return { ok: true, assets }
}

async function updateAssets(account) {
  if (!assetsGrid || !account?.address) return

  // Abort any in-flight request then clear the reference
  if (assetsFetchController) {
    assetsFetchController.abort()
    assetsFetchController = null
  }
  const controller = new AbortController()
  assetsFetchController = controller

  if (assetsLoading) assetsLoading.style.display = ''
  if (assetsEmpty) assetsEmpty.style.display = 'none'
  // Clear previous rows (Chromium/Electron optimised)
  assetsGrid.replaceChildren()
  if (assetsCount) assetsCount.textContent = ''

  if (!API_ENABLED) {
    if (assetsLoading) assetsLoading.style.display = 'none'
    if (assetsEmpty) { assetsEmpty.textContent = 'API not configured.'; assetsEmpty.style.display = '' }
    return
  }

  const chainId = Number(account.chainId ?? viemMainnet.id)

  // Order: 1) Moralis (primary), 2) Alchemy (secondary), 3) Etherscan (fallback). Keys in root .env.
  let json = null

  // 1) Primary: Moralis
  try {
    json = await fetchMoralisTokens(account.address, chainId, controller)
    if (json?.ok) {
      console.log('[assets] Moralis (primary) –', json.assets.length, 'tokens')
    }
  } catch (err) {
    if (err.name === 'AbortError') return
    console.warn('Moralis failed. Trying Alchemy (secondary)...', err)
  }

  // 2) Secondary: Alchemy
  if (!json) {
    try {
      const alchemyRes = await fetch(
        `${API_BASE}/api/assets?address=${encodeURIComponent(account.address)}&chainId=${chainId}`,
        { credentials: 'include', signal: controller.signal, headers: getApiHeaders() },
      )
      if (!alchemyRes.ok) {
        console.warn(`Alchemy returned HTTP ${alchemyRes.status}. Trying Etherscan (fallback)...`)
      } else {
        const alchemyJson = await alchemyRes.json().catch(() => null)
        if (alchemyJson?.ok) {
          json = alchemyJson
          console.log('[assets] Alchemy (secondary) –', (alchemyJson.assets ?? []).length, 'tokens')
        } else {
          console.warn('Alchemy response invalid. Trying Etherscan (fallback)...', alchemyJson?.error)
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      console.warn('Alchemy fetch failed. Trying Etherscan (fallback)...', err)
    }
  }

  // 3) Fallback: Etherscan
  if (!json) {
    try {
      const etherscanRes = await fetch(
        `${API_BASE}/api/etherscan-assets?address=${encodeURIComponent(account.address)}&chainId=${chainId}`,
        { credentials: 'include', signal: controller.signal, headers: getApiHeaders() },
      )
      if (!etherscanRes.ok) {
        console.warn(`Etherscan returned HTTP ${etherscanRes.status}.`)
      } else {
        const etherscanJson = await etherscanRes.json().catch(() => null)
        if (etherscanJson?.ok) {
          json = etherscanJson
          console.log('[assets] Etherscan (fallback) –', (etherscanJson.assets ?? []).length, 'tokens')
        } else {
          console.warn('Etherscan response invalid.', etherscanJson?.error)
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      console.warn('Etherscan fetch failed:', err)
    }
  }

  // Guard: if a newer call replaced our controller, discard this result
  if (assetsFetchController !== controller) return

  if (assetsLoading) assetsLoading.style.display = 'none'

  // When backend returns 503 (no API keys), try pinned tokens via public RPC so something still shows
  if (!json) {
    try {
      json = await fetchPinnedBalancesViaRpc(account.address, chainId, controller)
      if (assetsFetchController !== controller) return
      if (json?.ok && json.assets?.length) {
        console.log('[assets] Using RPC fallback for pinned tokens (backend APIs returned 503 or unavailable).')
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('RPC fallback for tokens failed:', err)
    }
  }

  if (!json) {
    if (assetsEmpty) {
      assetsEmpty.textContent = 'Could not load assets. Set MORALIS_API_KEY or ALCHEMY_API_KEY on the server for token data.'
      assetsEmpty.style.display = ''
    }
    return
  }

  const assets = json.assets ?? []
  const pinnedTokens = [
    { contractAddress: '0xa6Ec49E06C25F63292bac1Abc1896451A0f4cFB7', symbol: 'CSCS', name: 'CSCS Token', decimals: 18, balance: '0', logo: null },
    { contractAddress: '0x9C9580A8915d2797fb9E9651c93aE1559D8A498e', symbol: 'CSCR', name: 'CSCR Token', decimals: 18, balance: '0', logo: null },
  ]
  const hasPinned = assets.some(a => a.contractAddress?.toLowerCase() === '0xa6ec49e06c25f63292bac1abc1896451a0f4cfb7' || a.contractAddress?.toLowerCase() === '0x9c9580a8915d2797fb9e9651c93ae1559d8a498e')
  if (assets.length === 0 || !hasPinned) {
    for (const pinned of pinnedTokens) {
      if (!assets.some(a => a.contractAddress?.toLowerCase() === pinned.contractAddress.toLowerCase())) {
        assets.unshift(pinned)
      }
    }
  }
  if (assets.length === 0) {
    if (assetsEmpty) { assetsEmpty.textContent = 'No ERC-20 tokens found.'; assetsEmpty.style.display = '' }
    return
  }

  if (assetsCount) assetsCount.textContent = `${assets.length} token${assets.length !== 1 ? 's' : ''}`

  for (const token of assets) {
    const row = document.createElement('div')
    row.className = 'token-row'

    // Logo: image or placeholder — built with createElement (no innerHTML)
    if (token.logo) {
      const img = document.createElement('img')
      img.className = 'token-logo'
      img.src = token.logo
      img.alt = token.symbol ?? ''
      img.width = 32
      img.height = 32
      img.loading = 'lazy'
      row.appendChild(img)
    } else {
      const placeholder = document.createElement('div')
      placeholder.className = 'token-logo token-logo--placeholder'
      placeholder.textContent = (token.symbol ?? '??').slice(0, 2)
      row.appendChild(placeholder)
    }

    // Token info (name + symbol)
    const info = document.createElement('div')
    info.className = 'token-info'
    const nameSpan = document.createElement('span')
    nameSpan.className = 'token-name'
    nameSpan.textContent = token.name ?? 'Unknown Token'
    const symbolSpan = document.createElement('span')
    symbolSpan.className = 'token-symbol'
    symbolSpan.textContent = token.symbol ?? '???'
    info.appendChild(nameSpan)
    info.appendChild(symbolSpan)
    row.appendChild(info)

    // Balance — decimals: 0 is a valid ERC-20 value (e.g. some governance tokens).
    // Use == null (covers null & undefined) to detect truly missing data,
    // while still rendering "0" balances correctly.
    const balSpan = document.createElement('span')
    balSpan.className = 'token-balance'
    if (token.balance == null && token.rawBalance == null) {
      balSpan.textContent = 'Balance unavailable'
      balSpan.classList.add('token-balance--unknown')
    } else if (token.balance == null) {
      // Decimals unknown — show raw balance as-is
      balSpan.textContent = token.rawBalance ?? '0'
      balSpan.title = `Raw: ${token.rawBalance}`
      balSpan.classList.add('token-balance--unknown')
    } else {
      const num = Number(token.balance)
      if (Number.isFinite(num)) {
        balSpan.textContent = num.toLocaleString('en-US', { maximumFractionDigits: 6 })
      } else {
        balSpan.textContent = 'Invalid balance'
        balSpan.title = `Raw value: ${token.balance}`
        balSpan.classList.add('token-balance--unknown')
      }
    }
    row.appendChild(balSpan)

    assetsGrid.appendChild(row)
  }
}

// Default avatar pool for non-connected state
const DEFAULT_AVATAR_POOL = [
  '/avatar/avatar1.jpg',
  '/avatar/avatar2.jpg',
  '/avatar/avatar3.jpg',
  '/avatar/avatar4.jpg',
  '/avatar/avatar5.jpg',
  '/avatar/avatar6.jpg',
  '/avatar/avatar7.jpg',
  '/avatar/avatar8.jpg',
  '/avatar/avatar9.jpg',
  '/avatar/avatar10.jpg',
]
const _defaultAvatarIdx = Math.floor(Math.random() * DEFAULT_AVATAR_POOL.length)
const DEFAULT_AVATAR_URL = DEFAULT_AVATAR_POOL[_defaultAvatarIdx]

function showDefaultProfile() {
  if (!profileSection) return
  profileSection.style.display = ''
  if (profileAvatar) {
    profileAvatar.src = DEFAULT_AVATAR_URL
    profileAvatar.style.display = ''
  }
  if (profileDisplayName) profileDisplayName.textContent = 'Default'
  if (profileEmail) profileEmail.textContent = 'Connect wallet to edit'
  if (profileBio) profileBio.textContent = 'Connect your wallet to personalise your profile.'
  if (editProfileBtn) editProfileBtn.style.display = 'none'
}

// Show default profile immediately on page load
showDefaultProfile()

// Fetch and display user profile (avatar, display name, email, bio)
async function fetchAndDisplayProfile() {
  if (!profileSection) return;

  try {
    const data = await getProfileFromBackend();
    if (data?.ok && data.profile) {
      const profile = data.profile;

      // Update display elements
      if (profileAvatar && profile.avatarUrl) {
        profileAvatar.src = profile.avatarUrl;
        profileAvatar.style.display = '';
      } else if (profileAvatar) {
        profileAvatar.src = DEFAULT_AVATAR_URL;
        profileAvatar.style.display = '';
      }
      if (profileDisplayName) {
        profileDisplayName.textContent = profile.displayName || 'Default';
      }
      if (profileEmail) {
        profileEmail.textContent = profile.email || '—';
      }
      if (profileBio) {
        profileBio.textContent = profile.bio || '—';
      }

      // Show profile section and edit button (wallet is connected)
      profileSection.style.display = '';
      if (editProfileBtn) editProfileBtn.style.display = '';

      // Store current profile for edit modal
      window.currentProfile = profile;
    } else {
      // No profile data from server — show default
      showDefaultProfile();
    }
  } catch (err) {
    console.warn('Failed to fetch profile:', err);
    // Fallback to default
    showDefaultProfile();
  }
}

// Open profile edit modal
function openProfileEdit() {
  if (!profileEditModal || !window.currentProfile) return;

  // Populate form with current values
  if (profileEditNameInput) profileEditNameInput.value = window.currentProfile.displayName || '';
  if (profileEditEmailInput) profileEditEmailInput.value = window.currentProfile.email || '';
  if (profileEditBioInput) profileEditBioInput.value = window.currentProfile.bio || '';

  profileEditModal.style.display = 'flex';
}

// Close profile edit modal
function closeProfileEdit() {
  if (profileEditModal) profileEditModal.style.display = 'none';
}

// Save profile changes
async function saveProfileChanges() {
  try {
    const updates = {
      displayName: profileEditNameInput?.value || '',
      email: profileEditEmailInput?.value || '',
      bio: profileEditBioInput?.value || '',
      avatarUrl: window.currentProfile?.avatarUrl || null,
    };

    const result = await saveProfileToBackend(updates);
    if (result?.ok) {
      window.currentProfile = result.profile;
      closeProfileEdit();
      await fetchAndDisplayProfile();
      console.log('Profile saved successfully');
    }
  } catch (err) {
    console.error('Failed to save profile:', err);
    alert('Failed to save profile: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

// Attach profile event listeners
function attachProfileEventListeners() {
  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', openProfileEdit);
  }
  if (profileSaveBtn) {
    profileSaveBtn.addEventListener('click', saveProfileChanges);
  }
  if (profileCancelBtn) {
    profileCancelBtn.addEventListener('click', closeProfileEdit);
  }

  // Close modal on backdrop click
  if (profileEditModal) {
    profileEditModal.addEventListener('click', (e) => {
      if (e.target === profileEditModal) closeProfileEdit();
    });
  }
}

// Log activity to backend (login/disconnect only). data: { balance?, chainId?, connectorName? }
async function logActivity(type, address, data = {}) {
  if (!API_ENABLED) return // API not configured; skip logging
  const payload = typeof data === 'object' && data !== null
    ? { type, address, ...data }
    : { type, address, balance: data }
  try {
    await fetch(`${API_BASE}/api/log-activity`, {
      method: 'POST',
      headers: getApiHeaders(true),
      credentials: 'include',
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('logActivity failed:', err)
  }
}

// Log transaction to backend (MongoDB TransactionLog). Requires auth (JWT).
// payload: { type: 'Send'|'Swap'|'Receive'|'Buy', chainId, txHash, fromAddress?, toAddress?, amountEth?, kind?, tokenAddress?, tokenAmount?, connectorName? }
async function logTransaction(payload) {
  if (!API_ENABLED) return // API not configured; skip logging
  try {
    await fetch(`${API_BASE}/api/transactions`, {
      method: 'POST',
      headers: getApiHeaders(true),
      credentials: 'include',
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('logTransaction failed:', err)
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
    if (sendSection) sendSection.style.display = 'none'
    if (swapSection) swapSection.style.display = 'none'
    if (assetsSection) assetsSection.style.display = 'none'
    if (walletBanner) walletBanner.style.display = 'none'
    if (unsupportedOverlay) unsupportedOverlay.style.display = 'none'
    if (switchWalletBtn) switchWalletBtn.style.display = 'none'
    return
  }

  const account = getConnection(config)

  // If user clicked disconnect, treat as disconnected even if wagmi auto-reconnects
  if (userDisconnected || !account?.address) {
    statusEl.classList.remove('app-status--connected')
    statusEl.classList.add('app-status--disconnected')
    statusEl.textContent = 'Not connected'
    connectBtn.disabled = false
    connectBtn.style.display = ''
    disconnectBtn.disabled = true
    signBtn.disabled = true
    if (sendEthBtn) sendEthBtn.disabled = true
    if (swapBtn) swapBtn.disabled = true
    if (balanceEl) balanceEl.textContent = '—'
    if (balanceNetworkEl) balanceNetworkEl.textContent = ''
    if (sendSection) sendSection.style.display = 'none'
    if (swapSection) swapSection.style.display = 'none'
    if (assetsSection) assetsSection.style.display = 'none'
    if (assetsGrid) assetsGrid.replaceChildren()
    if (assetsCount) assetsCount.textContent = ''
    if (walletBanner) walletBanner.style.display = 'none'
    if (unsupportedOverlay) unsupportedOverlay.style.display = 'none'
    if (switchWalletBtn) switchWalletBtn.style.display = 'none'
    return
  }

  // ── Prominent banner: network + address ──
  const chainId = Number(account.chainId ?? viemMainnet.id)
  const chain = getViemChain(chainId)
  const isUnsupported = chain === null

  if (walletBanner) {
    walletBanner.style.display = ''
    if (bannerNetwork) bannerNetwork.textContent = chain?.name ?? `Chain ${chainId} (unsupported)`
    if (bannerDot) {
      bannerDot.classList.toggle('wallet-banner__dot--unsupported', isUnsupported)
    }
    if (bannerAddress) {
      const addr = account.address
      bannerAddress.textContent = `${addr.slice(0, 6)}…${addr.slice(-4)}`
      bannerAddress.title = addr
    }
  }

  // ── Unsupported network overlay ──
  if (unsupportedOverlay) {
    unsupportedOverlay.style.display = isUnsupported ? '' : 'none'
  }

  if (sendSection) sendSection.style.display = ''
  if (swapSection) swapSection.style.display = ''
  if (assetsSection) assetsSection.style.display = ''
  if (sendEthBtn) sendEthBtn.disabled = isUnsupported
  if (swapBtn) swapBtn.disabled = isUnsupported
  if (balanceEl) balanceEl.textContent = '…'
  statusEl.classList.remove('app-status--disconnected')
  statusEl.classList.add('app-status--connected')
  connectBtn.disabled = true
  connectBtn.style.display = 'none'
  disconnectBtn.disabled = false
  signBtn.disabled = false
  // Show Switch Wallet button when connected
  if (switchWalletBtn) switchWalletBtn.style.display = ''
  updateBalance(account)
  // Don't fetch assets here - wait until SIWE login completes
}


// Shared SIWE sign-in flow
// User-friendly message when the backend is not running (ERR_CONNECTION_REFUSED / Failed to fetch)
function wrapNetworkError(err) {
  const msg = String(err?.message ?? err)
  if (msg === 'Failed to fetch' || msg.includes('Load failed') || msg.includes('NetworkError') || msg.includes('connection refused')) {
    return new Error('Backend not reachable. Start it with: npm run server (or set VITE_API_URL to your API URL).')
  }
  return err instanceof Error ? err : new Error(msg)
}

async function doSiweSignIn() {
  if (!walletEnabled || !config) throw new Error('Wallet features are not available')
  if (!API_ENABLED) throw new Error('API is not configured')
  const account = getConnection(config)
  if (!account?.address) throw new Error('Not connected')

  const chainId = Number(account.chainId ?? viemMainnet.id)
  // In Electron production, window.location.origin is "file://" which isn't valid for SIWE.
  // Use the API server origin so the SIWE domain/uri match the server's WEB_ORIGIN.
  // In Electron dev (loaded from localhost:5173), window.location.origin works fine.
  const uri = IS_ELECTRON && API_BASE ? API_BASE : window.location.origin

  let msgRes
  try {
    msgRes = await fetch(
      `${API_BASE}/api/siwe/message?address=${encodeURIComponent(account.address)}&chainId=${chainId}&uri=${encodeURIComponent(uri)}`,
      { credentials: 'include', headers: getApiHeaders() },
    )
  } catch (err) {
    throw wrapNetworkError(err)
  }
  const msgJson = await msgRes.json().catch((err) => { console.error('SIWE message: JSON parse failed:', err); return {} })
  if (!msgRes.ok || !msgJson.ok) throw new Error(msgJson.error || `SIWE message request failed: ${msgRes.status}`)
  const message = msgJson.message

  const signature = await signMessage(config, {
    account: account.address,
    message,
  })

  let verifyRes
  try {
    verifyRes = await fetch(`${API_BASE}/api/siwe/verify`, {
      method: 'POST',
      headers: getApiHeaders(true),
      credentials: 'include',
      body: JSON.stringify({ message, signature }),
    })
  } catch (err) {
    throw wrapNetworkError(err)
  }
  const verifyJson = await verifyRes.json().catch((err) => { console.error('SIWE verify: JSON parse failed:', err); return {} })
  if (!verifyRes.ok || !verifyJson.ok) throw new Error(verifyJson.error || `Verify failed: ${verifyRes.status}`)

  await logActivity('login', account.address, {
    balance: verifyJson.balance ?? null,
    // Log the same chainId that was used for the SIWE message(if the user switches chains mid-flow)
    chainId,
    connectorName: account.connector?.name ?? null,
  })

  // Now that SIWE login is complete and JWT token is set, fetch authenticated assets
  updateAssets(account)

  // Fetch user profile (avatar, display name, email, bio)
  await fetchAndDisplayProfile()

  statusEl.classList.remove('app-status--disconnected')
  statusEl.classList.add('app-status--connected')
  statusEl.textContent = 'Signed in.'

  redirectAfterLoginIfNeeded()
}

if (walletEnabled && config) {
  watchConnections(config, {
    onChange() {
      render()
      // Auto SIWE sign-in when a wallet connects via the AppKit modal.
      // The modal handles connection asynchronously, so this is the
      // right place to trigger SIWE after the address is available.
      const account = getConnection(config)
      if (account?.address && !userDisconnected) {
        statusEl.textContent = 'Signing in…'
        doSiweSignIn()
          .catch((err) => {
            const friendly = err?.message ?? String(err)
            console.error('Auto SIWE sign-in failed:', friendly)
            statusEl.textContent = `Connected. Sign-in skipped:\n${friendly}`
          })
      }
    },
  })

  // Re-fetch assets when the user switches chains (e.g. Mainnet ↔ Sepolia)
  watchChainId(config, {
    onChange() {
      const account = getConnection(config)
      if (account?.address && !userDisconnected) {
        updateBalance(account)
        updateAssets(account)
      }
    },
  })

  // Sync UI and backend when user switches account in MetaMask
  // (Only relevant in web environments where window.ethereum exists)
  if (!IS_ELECTRON && window.ethereum) {
    window.ethereum.on('accountsChanged', () => {
      // Defer so wagmi can update connection state first
      setTimeout(() => {
        render()
        const account = getConnection(config)
        if (account?.address && !userDisconnected) {
          statusEl.textContent = 'Account changed. Signing in with new account...'
          doSiweSignIn().then(() => {}).catch((err) => {
            console.error('Account changed: SIWE sign-in failed:', err)
            statusEl.textContent = 'Account changed. Click "Sign-in (message)" to link this account.'
          })
        }
      }, 0)
    })
  }
}

// Banner address: click-to-copy (primary source of truth for displayed address)
if (bannerAddress) {
  bannerAddress.style.cursor = 'pointer'
  bannerAddress.addEventListener('click', async () => {
    const fullAddr = bannerAddress.title
    if (!fullAddr) return
    try {
      await navigator.clipboard.writeText(fullAddr)
      const original = bannerAddress.textContent
      bannerAddress.textContent = 'Copied!'
      bannerAddress.classList.add('wallet-banner__address--copied')
      setTimeout(() => {
        bannerAddress.textContent = original
        bannerAddress.classList.remove('wallet-banner__address--copied')
      }, 1500)
    } catch (e) {
      console.error('Banner copy failed:', e)
    }
  })
}

// Switch Wallet: disconnect current wallet, then immediately prompt re-connect
if (switchWalletBtn) {
  switchWalletBtn.addEventListener('click', async () => {
    if (!walletEnabled || !config) return
    try {
      // 1. Disconnect silently (no page reload)
      const account = getConnection(config)
      if (account?.address) {
        await logActivity('disconnect', account.address, {
          chainId: account.chainId ?? null,
          connectorName: account.connector?.name ?? null,
        })
      }

      // Clear backend session
      if (API_ENABLED) {
        try {
          await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include', headers: getApiHeaders(true) })
        } catch (err) {
          console.error('Switch wallet: logout failed:', err)
        }
      }

      // Revoke MetaMask permissions so the wallet selector appears on reconnect
      const provider = window.ethereum
      if (provider?.request) {
        try {
          await provider.request({
            method: 'wallet_revokePermissions',
            params: [{ eth_accounts: {} }],
          })
        } catch (err) {
          console.error('Switch wallet: revokePermissions failed:', err)
        }
      }

      await disconnect(config)
      userDisconnected = false // Reset so we can reconnect immediately

      // 2. Trigger fresh connect flow
      if (statusEl) statusEl.textContent = 'Switching wallet…'
      connectBtn.click()
    } catch (err) {
      if (statusEl) statusEl.textContent = `Switch wallet error:\n${String(err?.message ?? err)}`
    }
  })
}

connectBtn.addEventListener('click', async () => {
  if (!walletEnabled || !config) {
    if (statusEl) statusEl.textContent = 'Wallet features are not available. Check your project configuration.'
    return
  }

  userDisconnected = false

  // Environment-aware connection:
  // Web → use injected connector (MetaMask / browser extension) directly.
  // Electron → use AppKit modal (WalletConnect QR / external wallet).
  if (IS_ELECTRON) {
    if (!appKitModal) {
      const msg = '[CRITICAL] AppKit modal not available. Check VITE_REOWN_PROJECT_ID env var and app logs.'
      console.error('[main.js]', msg)
      statusEl.textContent = msg
      return
    }
    try {
      console.info('[main.js] Opening Reown AppKit QR modal for wallet selection...')
      statusEl.textContent = 'Choose a wallet…'
      await appKitModal.open()
      // AppKit handles connection asynchronously; watchConnections will
      // call render() and trigger SIWE sign-in when a wallet connects.
    } catch (err) {
      console.error('[main.js] AppKit error:', err)
      statusEl.textContent = `Connect error:\n${String(err?.message ?? err)}`
    }
  } else {
    // Web: connect via injected connector (MetaMask)
    try {
      console.info('[main.js] Connecting via injected MetaMask connector...')
      statusEl.textContent = 'Connecting to MetaMask…'
      await connect(config, { connector: injected() })
      // watchConnections fires onChange → render() + auto-SIWE
    } catch (err) {
      console.error('[main.js] MetaMask connection error:', err)
      statusEl.textContent = `Connect error:\n${String(err?.message ?? err)}`
    }
  }
})

// Auto-connect when opened from landing page or WW-Dash "Connect Account".
// In web: triggers MetaMask to open (unlock/sign-in).
// In Electron: triggers AppKit modal (WalletConnect QR / external wallet).
// The connected account is what /app/ uses for balance, assets, SIWE.
if (connectBtn && walletEnabled && config) {
  const params = new URLSearchParams(window.location.search)
  const hashConnect = window.location.hash === '#connect'
  if (params.get('connect') === '1' || hashConnect) {
    console.info('[main.js] Auto-connect triggered: ?connect=1 or #connect found')
    console.info('[main.js] Wallet state:', { IS_ELECTRON, walletEnabled, appKitModalExists: !!appKitModal, configExists: !!config })
    
    params.delete('connect')
    const cleanSearch = params.toString() ? '?' + params.toString() : ''
    const cleanHash = hashConnect ? '' : window.location.hash
    history.replaceState(null, '', window.location.pathname + cleanSearch + cleanHash)
    
    const triggerConnect = () => {
      console.info('[main.js] Triggering connect button click...')
      connectBtn.click()
    }
    
    if (document.readyState === 'complete') {
      console.info('[main.js] Page already loaded, scheduling connect in next frame')
      requestAnimationFrame(() => setTimeout(triggerConnect, 100))
    } else {
      console.info('[main.js] Page still loading, waiting for load event')
      window.addEventListener('load', () => setTimeout(triggerConnect, 100))
    }
  }
}

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
    if (API_ENABLED) {
      try {
        await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include', headers: getApiHeaders(true) })
      } catch (e) {
        console.error('Disconnect: logout request failed:', e)
      }
    }
    // Revoke wallet connection in MetaMask (EIP-2255) so the site is removed from Connected sites
    const provider = window.ethereum
    if (provider?.request) {
      try {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        })
      } catch (e) {
        console.error('Disconnect: wallet_revokePermissions not supported or failed:', e)
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
    } catch (renderErr) {
      console.error('Render failed during disconnect teardown:', renderErr)
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

// ── Single sendAsset dropdown ──────────────────────────────────────
if (sendAssetTrigger && sendAssetPanel && sendAsset && sendTokenAddress) {
  function closeSendDropdown() {
    sendAssetPanel.setAttribute('aria-hidden', 'true')
    sendAssetTrigger.setAttribute('aria-expanded', 'false')
  }

  sendAssetTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    const isOpen = sendAssetPanel.getAttribute('aria-hidden') !== 'true'
    if (isOpen) {
      closeSendDropdown()
    } else {
      sendAssetPanel.setAttribute('aria-hidden', 'false')
      sendAssetTrigger.setAttribute('aria-expanded', 'true')
    }
  })

  sendAssetPanel.querySelectorAll('.app-dropdown-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      const v = opt.getAttribute('data-value')
      sendAsset.value = v
      sendAssetTrigger.textContent = opt.textContent
      closeSendDropdown()

      // Auto-set token address from the Token Registry
      if (v !== 'eth' && PRESET_TOKENS[v]) {
        sendTokenAddress.value = PRESET_TOKENS[v].address
        // Keep contract populated for sends, but hide the field for preset tokens
        sendTokenAddress.style.display = 'none'
      } else {
        sendTokenAddress.value = ''
        sendTokenAddress.style.display = 'none'
      }
    })
  })

  document.addEventListener('click', closeSendDropdown)
  document.addEventListener('scroll', closeSendDropdown, true)

  // Sync trigger label from <select> on load
  const selectedOpt = sendAsset.options[sendAsset.selectedIndex]
  if (selectedOpt) sendAssetTrigger.textContent = selectedOpt.textContent
}

async function sendAssetFromApp(to, amountStr, assetKey, tokenAddressInput) {
  if (!walletEnabled || !config) {
    if (statusEl) statusEl.textContent = 'Wallet features are not available.'
    return
  }
  const account = getConnection(config)
  if (!account?.address) {
    statusEl.textContent = 'Connect your wallet first.'
    return
  }
  const isToken = assetKey !== 'eth'
  let tokenAddress = tokenAddressInput
  let tokenDecimals = null
  if (isToken && PRESET_TOKENS[assetKey]) {
    const p = PRESET_TOKENS[assetKey]
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
    statusEl.textContent = 'Select a token or enter a valid token contract address.'
    return
  }
  try {
    // Normalize chainId to a number for consistent comparisons and sendTransaction API
    const chainId = Number(account.chainId ?? viemMainnet.id)
    // Fetch decimals from chain if not hardcoded in PRESET_TOKENS
    if (isToken && tokenDecimals == null) {
      const chain = getViemChain(chainId)
      if (!chain) {
        statusEl.textContent = 'Unsupported network for token sends.';
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
    return hash
  } catch (err) {
    statusEl.textContent = `Send error:\n${String(err?.message ?? err)}`
    throw err
  }
}

if (sendEthBtn && sendToInput && sendAmountInput) {
  sendEthBtn.addEventListener('click', async () => {
    const to = sendToInput.value?.trim()
    const amountStr = sendAmountInput.value?.trim()
    const assetKey = sendAsset?.value ?? 'eth'
    const tokenAddressInput = sendTokenAddress?.value?.trim()
    try {
      await sendAssetFromApp(to, amountStr, assetKey, tokenAddressInput)
      // Clear inputs on success
      sendToInput.value = ''
      sendAmountInput.value = ''
      if (sendTokenAddress) sendTokenAddress.value = ''
    } catch {
      // errors already surfaced via statusEl
    }
  })
}

async function swapEthForTokenFromApp(amountStr, tokenOut) {
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
    return hash
  } catch (err) {
    statusEl.textContent = `Swap error:\n${String(err?.message ?? err)}`
    throw err
  }
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
    const amountStr = swapAmountInput.value?.trim()
    const tokenOut = swapTokenOutInput.value?.trim()
    try {
      await swapEthForTokenFromApp(amountStr, tokenOut)
      swapAmountInput.value = ''
      swapTokenOutInput.value = ''
    } catch {
      // errors already surfaced via statusEl
    }
  })
}

// Session persistence: reconnect on page load
if (walletEnabled && config) {
  reconnect(config)
    .then(() => {
      const account = getConnection(config)
      if (account?.address) {
        // Wallet reconnected successfully
        userDisconnected = false
        render()
        // Trigger SIWE sign-in if not already signed in
        statusEl.textContent = 'Signing in…'
        doSiweSignIn()
          .catch((err) => {
            const friendly = err?.message ?? String(err)
            console.error('Auto SIWE sign-in on reconnect failed:', friendly)
            statusEl.textContent = `Reconnected. Sign-in skipped:\n${friendly}`
          })
      } else {
        // Reconnect didn't restore a connection
        render()
      }
    })
    .catch((err) => {
      console.error('Reconnect on page load failed:', err)
      render()
    })
} else {
  render()
}

// Initialize profile event listeners on page load
attachProfileEventListeners()

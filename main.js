import { createConfig, connect, disconnect, getConnection, signMessage, watchConnections, sendTransaction } from '@wagmi/core'
import { injected } from '@wagmi/connectors'
import { http, parseEther, parseUnits, isAddress, createPublicClient, encodeFunctionData, getAddress } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// Uniswap V2 Router (mainnet) for swap
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const WETH_MAINNET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const ROUTER_ABI = [
  { inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], name: 'getAmountsOut', outputs: [{ name: 'amounts', type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], name: 'swapExactETHForTokens', outputs: [{ name: 'amounts', type: 'uint256[]' }], stateMutability: 'payable', type: 'function' },
]
const ERC20_ABI = [{ inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }]

// Preset ERC20 tokens (mainnet). WBTC = 8 decimals, RON = 18.
const PRESET_TOKENS = {
  btc: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, symbol: 'WBTC' },
  ron: { address: '0x23f043426b2336E723B32FB3BF4A1cA410F7c49a', decimals: 18, symbol: 'RON' },
}

const statusEl = document.getElementById('status')
const connectBtn = document.getElementById('connect')
const disconnectBtn = document.getElementById('disconnect')
const signBtn = document.getElementById('sign')
const meBtn = document.getElementById('walletAddress')
const privateBtn = document.getElementById('private')
const logoutBtn = document.getElementById('logout')
const loginGoogleBtn = document.getElementById('loginGoogle')
const loginFacebookBtn = document.getElementById('loginFacebook')
const sendToInput = document.getElementById('sendToInput')
const sendAmountInput = document.getElementById('sendAmountInput')
const sendEthBtn = document.getElementById('sendEthBtn')
const loadActivityBtn = document.getElementById('loadActivityBtn')
const activityLogEl = document.getElementById('activityLog')
const activityLogToggle = document.getElementById('activityLogToggle')
const activityLogChevron = document.getElementById('activityLogChevron')
const activityLogContent = document.getElementById('activityLogContent')
const receiveToggle = document.getElementById('receiveToggle')
const receiveChevron = document.getElementById('receiveChevron')
const receiveContent = document.getElementById('receiveContent')
const receiveAddress = document.getElementById('receiveAddress')
const receiveQr = document.getElementById('receiveQr')
const receiveCopy = document.getElementById('receiveCopy')
const sendKind = document.getElementById('sendKind')
const sendTokenPreset = document.getElementById('sendTokenPreset')
const sendTokenAddress = document.getElementById('sendTokenAddress')
const swapToggle = document.getElementById('swapToggle')
const swapChevron = document.getElementById('swapChevron')
const swapContent = document.getElementById('swapContent')
const swapAmountInput = document.getElementById('swapAmountInput')
const swapTokenOutInput = document.getElementById('swapTokenOutInput')
const swapBtn = document.getElementById('swapBtn')

// In production: set VITE_API_URL to your API origin, or leave unset when frontend and API are on the same host
const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3001')

const config = createConfig({
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  connectors: [
    injected({
      target: 'metaMask',
      // Wait for async provider injection (when multiple wallet extensions are present)
      unstable_shimAsyncInject: 2000,
    }),
  ],
})

// Track if user explicitly disconnected (wagmi may auto-reconnect otherwise)
let userDisconnected = false

// Log activity to backend (file or MongoDB). data: { balance?, chainId?, connectorName? }
async function logActivity(type, address, data = {}) {
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

function render() {
  const account = getConnection(config)

  // If user clicked disconnect, treat as disconnected even if wagmi auto-reconnects
  if (userDisconnected || !account?.address) {
    statusEl.textContent = 'Not connected'
    connectBtn.disabled = false
    disconnectBtn.disabled = true
    signBtn.disabled = true
    if (sendEthBtn) sendEthBtn.disabled = true
    if (swapBtn) swapBtn.disabled = true
    if (receiveAddress) receiveAddress.textContent = '—'
    if (receiveQr) { receiveQr.style.display = 'none'; receiveQr.removeAttribute('src') }
    return
  }

  if (sendEthBtn) sendEthBtn.disabled = false
  if (swapBtn) swapBtn.disabled = false
  if (receiveAddress) receiveAddress.textContent = account.address
  if (receiveQr) {
    receiveQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(account.address)}`
    receiveQr.style.display = 'block'
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

    const connector = config.connectors.find((c) => c.id === 'metaMask') ?? config.connectors[0]
    await connect(config, { connector })
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
    const extra = {
      chainId: account?.chainId ?? null,
      connectorName: account?.connector?.name ?? null,
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
        // Wallet may not support wallet_revokePermissions; continue with app disconnect
      }
    }
    await disconnect(config)
    userDisconnected = true
    logActivity('disconnect', address, extra)
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

    // Use numeric chainId (Wagmi may return number or bigint)
    const chainId = Number(account.chainId ?? mainnet.id)
    const uri = window.location.origin

    // Get a SIWE message from backend
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

    // Log successful login with balance, chainId, connector name
    logActivity('login', account.address, {
      balance: verifyJson.balance ?? null,
      chainId: account.chainId ?? null,
      connectorName: account.connector?.name ?? null,
    })

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

if (sendKind && sendTokenPreset && sendTokenAddress) {
  function updateTokenUi() {
    const isToken = sendKind.value === 'token'
    sendTokenPreset.style.display = isToken ? 'inline-block' : 'none'
    const preset = sendTokenPreset.value
    sendTokenAddress.style.display = isToken && preset === 'custom' ? 'block' : 'none'
    if (preset !== 'custom') sendTokenAddress.value = ''
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

if (sendEthBtn && sendToInput && sendAmountInput) {
  sendEthBtn.addEventListener('click', async () => {
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
      const chainId = account.chainId ?? mainnet.id
      statusEl.textContent = 'Confirm in MetaMask...'
      let hash
      if (isToken) {
        const amountWei = parseUnits(amountStr, tokenDecimals)
        const data = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [getAddress(to), amountWei],
        })
        hash = await sendTransaction(config, {
          to: /** @type {`0x${string}`} */ (tokenAddress),
          data,
          value: 0n,
          chainId,
          connector: account.connector,
        })
        await logActivity('transaction', account.address, { txHash: hash, chainId, kind: 'token', tokenAddress, tokenAmount: amountStr })
      } else {
        const value = parseEther(amountStr)
        hash = await sendTransaction(config, {
          to: /** @type {`0x${string}`} */ (to),
          value,
          chainId,
          connector: account.connector,
        })
        await logActivity('transaction', account.address, { txHash: hash, chainId })
      }
      statusEl.textContent = `Sent. Tx: ${hash}\nLogged to activity (file + MongoDB if enabled).`
      sendToInput.value = ''
      sendAmountInput.value = ''
      if (sendTokenAddress) sendTokenAddress.value = ''
    } catch (err) {
      statusEl.textContent = `Send error:\n${String(err?.message ?? err)}`
    }
  })
}

if (receiveToggle && receiveChevron && receiveContent) {
  receiveToggle.addEventListener('click', () => {
    const isHidden = receiveContent.style.display === 'none'
    receiveContent.style.display = isHidden ? '' : 'none'
    receiveChevron.textContent = isHidden ? '▼' : '▶'
  })
}
if (receiveCopy && receiveAddress) {
  receiveCopy.addEventListener('click', () => {
    const addr = receiveAddress.textContent
    if (addr && addr !== '—' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(addr).then(() => { statusEl.textContent = 'Address copied to clipboard.' })
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
    const account = getConnection(config)
    if (!account?.address) {
      statusEl.textContent = 'Connect your wallet first.'
      return
    }
    const chainId = Number(account.chainId ?? mainnet.id)
    if (chainId !== mainnet.id) {
      statusEl.textContent = 'Swap is available on mainnet only. Switch to Ethereum Mainnet in MetaMask.'
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
      const path = [WETH_MAINNET, getAddress(tokenOut)]
      const publicClient = createPublicClient({ chain: mainnet, transport: http() })
      const amounts = await publicClient.readContract({
        address: /** @type {`0x${string}`} */ (UNISWAP_V2_ROUTER),
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
      statusEl.textContent = 'Confirm swap in MetaMask...'
      const hash = await sendTransaction(config, {
        to: /** @type {`0x${string}`} */ (UNISWAP_V2_ROUTER),
        value: amountIn,
        data,
        chainId: mainnet.id,
        connector: account.connector,
      })
      await logActivity('transaction', account.address, { txHash: hash, chainId: mainnet.id, kind: 'swap' })
      statusEl.textContent = `Swap submitted. Tx: ${hash}\nLogged to activity.`
      swapAmountInput.value = ''
      swapTokenOutInput.value = ''
    } catch (err) {
      statusEl.textContent = `Swap error:\n${String(err?.message ?? err)}`
    }
  })
}

if (activityLogToggle && activityLogChevron && activityLogContent) {
  activityLogToggle.addEventListener('click', () => {
    const isHidden = activityLogContent.style.display === 'none'
    activityLogContent.style.display = isHidden ? '' : 'none'
    activityLogChevron.textContent = isHidden ? '▼' : '▶'
  })
}

if (loadActivityBtn && activityLogEl) {
  loadActivityBtn.addEventListener('click', async () => {
    const account = getConnection(config)
    const address = account?.address ? `${encodeURIComponent(account.address)}` : ''
    const url = address ? `${API_BASE}/api/activity?limit=50&address=${address}` : `${API_BASE}/api/activity?limit=50`
    try {
      activityLogEl.textContent = 'Loading…'
      const res = await fetch(url, { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        activityLogEl.textContent = json.error || `Failed: ${res.status}`
        return
      }
      const list = json.activity || []
      if (list.length === 0) {
        activityLogEl.textContent = 'No activity yet.'
        return
      }
      const lines = list.map((e) => {
        const parts = [`[${e.time || '—'}] ${e.status} | ${(e.address || '').slice(0, 10)}…`]
        if (e.kind) parts.push(`Kind: ${e.kind}`)
        if (e.balance != null) parts.push(`Balance: ${e.balance} ETH`)
        if (e.chainId != null) parts.push(`Chain: ${e.chainId}`)
        if (e.txHash) parts.push(`Tx: ${e.txHash.slice(0, 18)}…`)
        if (e.from) parts.push(`From: ${e.from.slice(0, 10)}…`)
        if (e.to) parts.push(`To: ${e.to.slice(0, 10)}…`)
        if (e.amountEth != null) parts.push(`Amount: ${e.amountEth} ETH`)
        if (e.tokenAmount != null) parts.push(`Token amt: ${e.tokenAmount}`)
        if (e.block != null) parts.push(`Block: ${e.block}`)
        return parts.join(' | ')
      })
      activityLogEl.textContent = lines.join('\n')
    } catch (err) {
      activityLogEl.textContent = `Error: ${err?.message ?? err}`
    }
  })
}

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

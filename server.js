import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import { isAddress, verifyMessage, getBalance, createPublicClient, http, formatEther } from 'viem'
import { mainnet } from 'viem/chains'
import { SiweMessage } from 'siwe'
import rateLimit from 'express-rate-limit'
import { appendFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ACTIVITY_LOG_PATH = join(__dirname, 'activity.txt')

// Check if activity log file exists and has content
async function isLogFileEmpty() {
  try {
    const stats = await stat(ACTIVITY_LOG_PATH)
    return stats.size === 0
  } catch {
    return true // file doesn't exist
  }
}

const app = express()

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'
const IS_PROD = process.env.NODE_ENV === 'production'

if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me')) {
  console.error('Fatal: Set JWT_SECRET to a strong random value in production.')
  process.exit(1)
}

// Public client for fetching balances (uses public RPC or custom RPC_URL from env)
const rpcUrl = process.env.RPC_URL || `https://eth.llamarpc.com` // Public RPC fallback
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl),
})

function requireAuth(req, res, next) {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ ok: false, error: 'Not logged in' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const isWallet = payload.sub.startsWith('0x') && isAddress(payload.sub)
    req.user = {
      address: isWallet ? payload.sub : null,
      provider: payload.provider ?? null,
      email: payload.email ?? null,
      name: payload.name ?? null,
      sub: payload.sub,
    }
    return next()
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid/expired token' })
  }
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin
      if (!origin) return callback(null, true)

      // Allow Vite dev origins (localhost + 127.0.0.1)
      const isViteDevOrigin = /^http:\/\/(localhost|127\.0\.0\.1):517\d$/.test(origin)
      if (isViteDevOrigin) return callback(null, true)

      // Optional override for custom frontend origin
      const allow = process.env.WEB_ORIGIN
      if (allow && origin === allow) return callback(null, true)

      return callback(new Error(`CORS blocked for origin: ${origin}`))
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: '64kb' }))
app.use(cookieParser())

const nonceByAddress = new Map()
const NONCE_TTL_MS = 5 * 60 * 1000
// NOTE: nonce store is in-memory; swap with Redis/DB in production for multi-instance.

// ----- SIWE hardening -----
const SIWE_STATEMENT = 'Sign in with Ethereum to Web3 Login System.'
const SIWE_TTL_MS = 10 * 60 * 1000
const SIWE_CLOCK_SKEW_MS = 2 * 60 * 1000
const ALLOWED_CHAIN_IDS = new Set([mainnet.id])

// ----- Rate limits -----
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 50, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
})

const strictAuthLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
})

// OAuth state -> { returnTo, expiresAt } (CSRF and redirect after login)
const oauthState = new Map()
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

function getBaseUrl(req) {
  const host = req.get('host') || req.get('x-forwarded-host')
  const proto = req.get('x-forwarded-proto') || (IS_PROD ? 'https' : 'http')
  return `${proto}://${host}`
}

function getReturnTo(req) {
  const q = req.query.returnTo
  if (typeof q === 'string' && q.startsWith('http')) return q
  return process.env.WEB_ORIGIN || (IS_PROD ? null : 'http://localhost:5173')
}

function issueNonce(address) {
  const nonce = crypto.randomUUID()
  const expiresAt = Date.now() + NONCE_TTL_MS
  nonceByAddress.set(address.toLowerCase(), { nonce, expiresAt })
  return { nonce, expiresAt }
}

function takeNonce(address) {
  const key = address.toLowerCase()
  const entry = nonceByAddress.get(key)
  nonceByAddress.delete(key) // one-time use
  if (!entry) return null
  if (Date.now() > entry.expiresAt) return null
  return entry.nonce
}

function extractNonceFromMessage(message) {

  const match = message.match(/^Nonce:\s*(.+)$/m)
  return match?.[1]?.trim() ?? null
}

app.get('/api/nonce', authLimiter, (req, res) => {
  const address = String(req.query.address ?? '')
  if (!isAddress(address)) return res.status(400).json({ error: 'Invalid address' })
  const { nonce, expiresAt } = issueNonce(address)
  res.json({ address, nonce, expiresAt })
})

// ----- SIWE (EIP-4361) -----
app.get('/api/siwe/message', authLimiter, (req, res) => {
  const address = String(req.query.address ?? '')
  const chainId = Number(req.query.chainId ?? mainnet.id)
  const uri = String(req.query.uri ?? '')
  if (!isAddress(address)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  if (!ALLOWED_CHAIN_IDS.has(chainId)) return res.status(400).json({ ok: false, error: 'Unsupported chainId' })
  if (!uri.startsWith('http')) return res.status(400).json({ ok: false, error: 'Invalid uri' })

  let domain
  try {
    domain = new URL(uri).host
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid uri' })
  }

  const { nonce, expiresAt } = issueNonce(address)
  const issuedAt = new Date()
  const expirationTime = new Date(issuedAt.getTime() + SIWE_TTL_MS)
  const msg = new SiweMessage({
    domain,
    address,
    statement: SIWE_STATEMENT,
    uri,
    version: '1',
    chainId,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expirationTime: expirationTime.toISOString(),
    notBefore: issuedAt.toISOString(),
  })

  return res.json({ ok: true, message: msg.prepareMessage(), nonce, expiresAt })
})

app.post('/api/siwe/verify', strictAuthLimiter, async (req, res) => {
  const { message, signature } = req.body ?? {}
  if (typeof message !== 'string' || !message.length) return res.status(400).json({ ok: false, error: 'Missing message' })
  if (typeof signature !== 'string' || !signature.length) return res.status(400).json({ ok: false, error: 'Missing signature' })

  let siwe
  try {
    siwe = new SiweMessage(message)
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid SIWE message' })
  }

  const address = siwe.address
  if (!isAddress(address)) return res.status(400).json({ ok: false, error: 'Invalid address' })


  if (siwe.version !== '1') return res.status(400).json({ ok: false, error: 'Invalid SIWE version' })
  if (siwe.statement !== SIWE_STATEMENT) return res.status(400).json({ ok: false, error: 'Invalid SIWE statement' })
  if (!ALLOWED_CHAIN_IDS.has(Number(siwe.chainId))) return res.status(400).json({ ok: false, error: 'Unsupported chainId' })


  const allowedOrigins = new Set()
  if (process.env.WEB_ORIGIN) allowedOrigins.add(process.env.WEB_ORIGIN)
  if (!IS_PROD) {
    allowedOrigins.add('http://localhost:5173')
    allowedOrigins.add('http://127.0.0.1:5173')
  }

  let msgOrigin
  try {
    msgOrigin = new URL(siwe.uri).origin
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid uri in SIWE message' })
  }
  if (allowedOrigins.size && !allowedOrigins.has(msgOrigin)) {
    return res.status(400).json({ ok: false, error: `Invalid origin: ${msgOrigin}` })
  }
  const expectedDomain = new URL(msgOrigin).host
  if (siwe.domain !== expectedDomain) {
    return res.status(400).json({ ok: false, error: 'SIWE domain mismatch' })
  }

  // Time window checks (prevents very old/future messages)
  const now = Date.now()
  const issuedAtMs = Date.parse(siwe.issuedAt || '')
  if (!Number.isFinite(issuedAtMs)) return res.status(400).json({ ok: false, error: 'Invalid issuedAt' })
  if (issuedAtMs > now + SIWE_CLOCK_SKEW_MS) return res.status(400).json({ ok: false, error: 'issuedAt is in the future' })
  if (now - issuedAtMs > SIWE_TTL_MS + SIWE_CLOCK_SKEW_MS) return res.status(400).json({ ok: false, error: 'SIWE message too old' })

  const expirationMs = Date.parse(siwe.expirationTime || '')
  if (!Number.isFinite(expirationMs)) return res.status(400).json({ ok: false, error: 'Missing/invalid expirationTime' })
  if (now > expirationMs + SIWE_CLOCK_SKEW_MS) return res.status(400).json({ ok: false, error: 'SIWE message expired' })

  if (siwe.notBefore) {
    const notBeforeMs = Date.parse(siwe.notBefore)
    if (!Number.isFinite(notBeforeMs)) return res.status(400).json({ ok: false, error: 'Invalid notBefore' })
    if (now + SIWE_CLOCK_SKEW_MS < notBeforeMs) return res.status(400).json({ ok: false, error: 'SIWE message not active yet' })
  }

  const expectedNonce = takeNonce(address)
  if (!expectedNonce) return res.status(400).json({ ok: false, error: 'Missing/expired nonce. Request a new SIWE message.' })
  if (siwe.nonce !== expectedNonce) return res.status(400).json({ ok: false, error: 'Nonce mismatch' })

  const verifyResult = await siwe.verify({
    signature,
    domain: expectedDomain,
    nonce: expectedNonce,
    time: new Date().toISOString(),
  })
  if (!verifyResult.success) return res.status(401).json({ ok: false, error: 'Invalid SIWE signature' })

  // Fetch balance (best-effort, don't fail login if this fails)
  let balanceEth = null
  try {
    const balance = await getBalance(publicClient, { address })
    balanceEth = formatEther(balance)
  } catch (err) {
    console.warn('Failed to fetch balance for', address, err.message)
  }

  // Issue JWT in an HttpOnly cookie
  const token = jwt.sign({ sub: address.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' })
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
  return res.json({ ok: true, balance: balanceEth })
})

app.post('/api/verify', strictAuthLimiter, async (req, res) => {
  const { address, message, signature } = req.body ?? {}
  if (!isAddress(address)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  if (typeof message !== 'string' || !message.length) return res.status(400).json({ ok: false, error: 'Missing message' })
  if (typeof signature !== 'string' || !signature.length)
    return res.status(400).json({ ok: false, error: 'Missing signature' })

  const expectedNonce = takeNonce(address)
  if (!expectedNonce) return res.status(400).json({ ok: false, error: 'Missing/expired nonce. Request a new nonce.' })

  const messageNonce = extractNonceFromMessage(message)
  if (!messageNonce || messageNonce !== expectedNonce)
    return res.status(400).json({ ok: false, error: 'Nonce mismatch' })

  try {
    const valid = await verifyMessage({
      address,
      message,
      signature,
    })

    if (!valid) return res.status(401).json({ ok: false, error: 'Invalid signature' })

    // Fetch balance (best-effort, don't fail login if this fails)
    let balanceEth = null
    try {
      const balance = await getBalance(publicClient, { address })
      balanceEth = formatEther(balance)
    } catch (err) {
      console.warn('Failed to fetch balance for', address, err.message)
    }

    // Issue JWT in an HttpOnly cookie
    const token = jwt.sign({ sub: address.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' })
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD, // true on HTTPS in production
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    return res.json({ ok: true, balance: balanceEth })
  } catch (err) {
    return res.status(400).json({ ok: false, error: String(err?.message ?? err) })
  }
})

app.get('/api/walletAddress', (req, res) => {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ ok: false, error: 'Not logged in' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const isWallet = payload.sub.startsWith('0x') && isAddress(payload.sub)
    return res.json({
      ok: true,
      address: isWallet ? payload.sub : null,
      provider: payload.provider ?? null,
      email: payload.email ?? null,
      name: payload.name ?? null,
    })
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid/expired token' })
  }
})

// ----- Google OAuth -----
app.get('/api/auth/google', authLimiter, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.status(503).json({ ok: false, error: 'Google login not configured' })
  const returnTo = getReturnTo(req)
  if (!returnTo) return res.status(400).json({ ok: false, error: 'Set WEB_ORIGIN or pass returnTo' })
  const state = crypto.randomBytes(24).toString('hex')
  oauthState.set(state, { returnTo, expiresAt: Date.now() + OAUTH_STATE_TTL_MS })
  const base = getBaseUrl(req)
  const redirectUri = `${base}/api/auth/google/callback`
  const scope = encodeURIComponent('email profile')
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&state=${state}`
  res.redirect(302, url)
})

app.get('/api/auth/google/callback', strictAuthLimiter, async (req, res) => {
  const { code, state } = req.query
  const entry = state ? oauthState.get(state) : null
  oauthState.delete(state)
  if (!code || typeof code !== 'string' || !entry || Date.now() > entry.expiresAt) {
    return res.redirect(entry?.returnTo ? `${entry.returnTo}?auth_error=invalid_state` : '/')
  }
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return res.redirect(`${entry.returnTo}?auth_error=config`)

  const base = getBaseUrl(req)
  const redirectUri = `${base}/api/auth/google/callback`
  let tokenRes
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
  } catch (e) {
    console.error('Google token exchange error:', e)
    return res.redirect(`${entry.returnTo}?auth_error=token`)
  }
  if (!tokenRes.ok) {
    const t = await tokenRes.text()
    console.error('Google token response:', tokenRes.status, t)
    return res.redirect(`${entry.returnTo}?auth_error=token`)
  }
  const tokens = await tokenRes.json()
  const accessToken = tokens.access_token
  if (!accessToken) return res.redirect(`${entry.returnTo}?auth_error=token`)

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!userRes.ok) return res.redirect(`${entry.returnTo}?auth_error=userinfo`)
  const profile = await userRes.json()
  const sub = `google|${profile.id}`
  const token = jwt.sign(
    { sub, provider: 'google', email: profile.email ?? null, name: profile.name ?? null },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
  console.log('Activity: social login google', profile.email || profile.id)
  res.redirect(302, entry.returnTo)
})

// ----- Facebook OAuth -----
app.get('/api/auth/facebook', authLimiter, (req, res) => {
  const appId = process.env.FACEBOOK_APP_ID
  if (!appId) return res.status(503).json({ ok: false, error: 'Facebook login not configured' })
  const returnTo = getReturnTo(req)
  if (!returnTo) return res.status(400).json({ ok: false, error: 'Set WEB_ORIGIN or pass returnTo' })
  const state = crypto.randomBytes(24).toString('hex')
  oauthState.set(state, { returnTo, expiresAt: Date.now() + OAUTH_STATE_TTL_MS })
  const base = getBaseUrl(req)
  const redirectUri = `${base}/api/auth/facebook/callback`
  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email,public_profile&state=${state}`
  res.redirect(302, url)
})

app.get('/api/auth/facebook/callback', strictAuthLimiter, async (req, res) => {
  const { code, state } = req.query
  const entry = state ? oauthState.get(state) : null
  oauthState.delete(state)
  if (!code || typeof code !== 'string' || !entry || Date.now() > entry.expiresAt) {
    return res.redirect(entry?.returnTo ? `${entry.returnTo}?auth_error=invalid_state` : '/')
  }
  const appId = process.env.FACEBOOK_APP_ID
  const appSecret = process.env.FACEBOOK_APP_SECRET
  if (!appId || !appSecret) return res.redirect(`${entry.returnTo}?auth_error=config`)

  const base = getBaseUrl(req)
  const redirectUri = `${base}/api/auth/facebook/callback`
  const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
  let tokenRes
  try {
    tokenRes = await fetch(tokenUrl)
  } catch (e) {
    console.error('Facebook token exchange error:', e)
    return res.redirect(`${entry.returnTo}?auth_error=token`)
  }
  if (!tokenRes.ok) {
    const t = await tokenRes.text()
    console.error('Facebook token response:', tokenRes.status, t)
    return res.redirect(`${entry.returnTo}?auth_error=token`)
  }
  const tokens = await tokenRes.json()
  const accessToken = tokens.access_token
  if (!accessToken) return res.redirect(`${entry.returnTo}?auth_error=token`)

  const userUrl = `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`
  const userRes = await fetch(userUrl)
  if (!userRes.ok) return res.redirect(`${entry.returnTo}?auth_error=userinfo`)
  const profile = await userRes.json()
  const sub = `facebook|${profile.id}`
  const token = jwt.sign(
    { sub, provider: 'facebook', email: profile.email ?? null, name: profile.name ?? null },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
  console.log('Activity: social login facebook', profile.email || profile.id)
  res.redirect(302, entry.returnTo)
})

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { path: '/' })
  res.json({ ok: true })
})

app.get('/api/private', requireAuth, (req, res) => {
  res.json({
    ok: true,
    address: req.user.address,
    provider: req.user.provider,
    email: req.user.email,
    name: req.user.name,
    secret: 'This is protected data only visible when logged in.',
  })
})

// Appends locally to activity.txt
app.post('/api/log-activity', async (req, res) => {
  const { type, address, balance } = req.body ?? {}
  if (!type || !address) return res.status(400).json({ ok: false, error: 'Missing type or address' })
  if (!isAddress(address)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  const allowedTypes = ['login', 'disconnect']
  if (!allowedTypes.includes(type)) return res.status(400).json({ ok: false, error: 'Invalid type' })

  const now = new Date()
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
  const time = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  const userAgent = req.get('user-agent') || 'unknown'
  const status = type === 'login' ? 'Logged In' : type === 'disconnect' ? 'Disconnected' : type

  try {
    // Add header if file is new/empty
    if (await isLogFileEmpty()) {
      const header = `${'='.repeat(120)}
ACTIVITY LOG - Web3 Login System
${'='.repeat(120)}

`
      await appendFile(ACTIVITY_LOG_PATH, header)
    }

    const balanceLine = balance != null ? `Balance:         ${balance} ETH\n` : ''
    const entry = `${'─'.repeat(80)}
Time:           ${date} ${time}
Status:         ${status}
Wallet Address: ${address}
${balanceLine}IP Address:     ${ip}
User Agent:     ${userAgent}
`

    await appendFile(ACTIVITY_LOG_PATH, entry)
    return res.json({ ok: true })
  } catch (err) {
    console.error('Failed to write activity log:', err)
    return res.status(500).json({ ok: false, error: 'Failed to log activity' })
  }
})

// In production, optionally serve the frontend from the same server (e.g. single Render deploy)
if (IS_PROD) {
  const distPath = join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(join(distPath, 'index.html'), (err) => { if (err) next() })
  })
}

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => {
  console.log(`Auth API listening on http://127.0.0.1:${port}`)
})

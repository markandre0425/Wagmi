import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import { isAddress, verifyMessage, createPublicClient, http, formatEther } from 'viem'
import { mainnet } from 'viem/chains'
import { SiweMessage } from 'siwe'
import rateLimit from 'express-rate-limit'
import Redis from 'ioredis' // optional for nonce (fallback to memory if unavailable)
import mongoose from 'mongoose' // optional for logs (fallback to file if unavailable)
import { appendFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()

// DATABASE CONNECTIONS (optional; fallback to in-memory/file)

let redis = null
if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL)
    redis.on('error', (err) => console.error('Redis Client Error', err))
    redis.on('connect', () => console.log('Connected to Redis'))
  } catch (err) {
    console.error('Redis init failed; falling back to in-memory nonces:', err)
    redis = null
  }
}

let ActivityLog = null
if (process.env.MONGO_URI) {
  const MONGO_URI = process.env.MONGO_URI
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err))

  const ActivityLogSchema = new mongoose.Schema({
    type: { type: String, required: true, enum: ['login', 'disconnect'] },
    address: { type: String, required: true, index: true },
    balance: { type: String },
    ip: String,
    userAgent: String,
    timestamp: { type: Date, default: Date.now },
  })
  ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema)
} else {
  console.log('MONGO_URI not set; activity logs will use file fallback.')
}
// ------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const ACTIVITY_LOG_PATH = join(__dirname, 'activity.txt')


const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'
const IS_PROD = process.env.NODE_ENV === 'production'

if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me')) {
  console.error('Fatal: Set JWT_SECRET to a strong random value in production.')
  process.exit(1)
}

// Public client for fetching balances
const rpcUrl = process.env.RPC_URL || `https://eth.llamarpc.com`
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

app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      const isViteDevOrigin = /^http:\/\/(localhost|127\.0\.0\.1):517\d$/.test(origin)
      if (isViteDevOrigin) return callback(null, true)
      const allow = process.env.WEB_ORIGIN
      if (allow && origin === allow) return callback(null, true)
      return callback(new Error(`CORS blocked for origin: ${origin}`))
    },
    credentials: true,
}))
app.use(express.json({ limit: '64kb' }))
app.use(cookieParser())


// UPDATED NONCE LOGIC (Redis if available, else in-memory)

const NONCE_TTL_SECONDS = 300 // 5 minutes
const nonceMemory = new Map()

const getNonceKey = (address) => `nonce:${address.toLowerCase()}`

async function issueNonce(address) {
  const nonce = crypto.randomUUID()
  const key = getNonceKey(address)

  if (redis) {
    await redis.set(key, nonce, 'EX', NONCE_TTL_SECONDS)
  } else {
    const expiresAt = Date.now() + NONCE_TTL_SECONDS * 1000
    nonceMemory.set(key, { nonce, expiresAt })
  }

  return { nonce, expiresAt: Date.now() + NONCE_TTL_SECONDS * 1000 }
}

async function takeNonce(address) {
  const key = getNonceKey(address)

  if (redis) {
    const nonce = await redis.get(key)
    if (nonce) await redis.del(key)
    return nonce
  }

  const entry = nonceMemory.get(key)
  nonceMemory.delete(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) return null
  return entry.nonce
}
// ------------------------------------------------------------------

// Helper to check if log file is empty (for adding headers)
async function isLogFileEmpty() {
  try {
    const stats = await stat(ACTIVITY_LOG_PATH)
    return stats.size === 0
  } catch {
    return true // file doesn't exist yet
  }
}

const SIWE_STATEMENT = 'Sign in with Ethereum to Web3 Login System.'
const SIWE_TTL_MS = 10 * 60 * 1000
const SIWE_CLOCK_SKEW_MS = 2 * 60 * 1000
const ALLOWED_CHAIN_IDS = new Set([mainnet.id])

// Rate limits
const authLimiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false })
const strictAuthLimiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false })

// Helper: Extract Nonce from Message
function extractNonceFromMessage(message) {
  const match = message.match(/^Nonce:\s*(.+)$/m)
  return match?.[1]?.trim() ?? null
}

// API: Get Nonce
app.get('/api/nonce', authLimiter, async (req, res) => {
  const address = String(req.query.address ?? '')
  if (!isAddress(address)) return res.status(400).json({ error: 'Invalid address' })
  
  try {
    const { nonce, expiresAt } = await issueNonce(address)
    res.json({ address, nonce, expiresAt })
  } catch (err) {
    console.error('Redis error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// API: SIWE Message (Sign-In With Ethereum)
app.get('/api/siwe/message', authLimiter, async (req, res) => {
  const address = String(req.query.address ?? '')
  const chainId = Number(req.query.chainId ?? mainnet.id)
  const uri = String(req.query.uri ?? '')

  if (!isAddress(address)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  if (!ALLOWED_CHAIN_IDS.has(chainId)) return res.status(400).json({ ok: false, error: 'Unsupported chainId' })

  let domain
  try {
    domain = new URL(uri).host
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid uri' })
  }

  try {
    const { nonce } = await issueNonce(address)
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
  
    return res.json({ ok: true, message: msg.prepareMessage(), nonce })
  } catch (err) {
    console.error('SIWE generation error:', err)
    res.status(500).json({ ok: false, error: 'Internal error' })
  }
})

// API: SIWE Verify
app.post('/api/siwe/verify', strictAuthLimiter, async (req, res) => {
  const { message, signature } = req.body ?? {}
  if (!message || !signature) return res.status(400).json({ ok: false, error: 'Missing data' })

  let siwe
  try {
    siwe = new SiweMessage(message)
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid SIWE message' })
  }

  // Standard SIWE field checks 
  if (siwe.version !== '1') return res.status(400).json({ ok: false, error: 'Invalid SIWE version' })
  if (siwe.statement !== SIWE_STATEMENT) return res.status(400).json({ ok: false, error: 'Invalid SIWE statement' })
  if (!isAddress(siwe.address)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  if (!ALLOWED_CHAIN_IDS.has(Number(siwe.chainId))) return res.status(400).json({ ok: false, error: 'Unsupported chainId' })

  // Validate expected frontend origin/domain
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

  // Verify Nonce (Async now)
  const expectedNonce = await takeNonce(siwe.address)
  if (!expectedNonce) return res.status(400).json({ ok: false, error: 'Missing/expired nonce. Request a new SIWE message.' })
  if (siwe.nonce !== expectedNonce) return res.status(400).json({ ok: false, error: 'Nonce mismatch' })

  const verifyResult = await siwe.verify({
    signature,
    domain: expectedDomain,
    nonce: expectedNonce,
    time: new Date().toISOString(),
  })
  
  if (!verifyResult.success) return res.status(401).json({ ok: false, error: 'Invalid SIWE signature' })

  // Balance Check
  let balanceEth = null
  try {
    const balance = await publicClient.getBalance({ address: siwe.address })
    balanceEth = formatEther(balance)
  } catch (err) {
    console.warn('Balance fetch failed', err.message)
  }

  // Issue Token
  const token = jwt.sign({ sub: siwe.address.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' })
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
  
  return res.json({ ok: true, balance: balanceEth })
})

// 3. UPDATED LOGGING (Using MongoDB)
// ------------------------------------------------------------------
app.post('/api/log-activity', async (req, res) => {
  const { type, address, balance } = req.body ?? {}
  if (!type || !address) return res.status(400).json({ ok: false, error: 'Missing data' })
  if (!['login', 'disconnect'].includes(type)) return res.status(400).json({ ok: false, error: 'Invalid type' })

  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  const userAgent = req.get('user-agent') || 'unknown'

  try {
    if (ActivityLog) {
      await ActivityLog.create({
        type,
        address,
        balance: balance ? String(balance) : null,
        ip,
        userAgent,
      })
      return res.json({ ok: true })
    }

    // Fallback: append to file
    const now = new Date()
    const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
    const time = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const balanceLine = balance ? `Balance:         ${balance} ETH\n` : ''

    if (await isLogFileEmpty()) {
      const header = `${'='.repeat(120)}
ACTIVITY LOG - Web3 Login System
${'='.repeat(120)}

`
      await appendFile(ACTIVITY_LOG_PATH, header)
    }

    const entry = `${'─'.repeat(80)}
Time:           ${date} ${time}
Status:         ${type === 'login' ? 'Logged In' : 'Disconnected'}
Wallet Address: ${address}
${balanceLine}IP Address:     ${ip}
User Agent:     ${userAgent}
`
    await appendFile(ACTIVITY_LOG_PATH, entry)
    return res.json({ ok: true })
  } catch (err) {
    console.error('Failed to write activity log:', err)
    return res.status(500).json({ ok: false, error: 'Logging failed' })
  }
})
// ------------------------------------------------------------------


// 4. SESSION / USER ROUTES (used by frontend buttons)
// ------------------------------------------------------------------
app.get('/api/walletAddress', (req, res) => {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ ok: false, error: 'Not logged in' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const isWallet = typeof payload.sub === 'string' && payload.sub.startsWith('0x') && isAddress(payload.sub)
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

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { path: '/' })
  res.json({ ok: true })
})

// In production, optionally serve the frontend from the same server
if (IS_PROD) {
  const distPath = join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(join(distPath, 'index.html'), (err) => {
      if (err) next()
    })
  })
}
// ------------------------------------------------------------------

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => {
  console.log(`Auth API listening on http://127.0.0.1:${port}`)
})
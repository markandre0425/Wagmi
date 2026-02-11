import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import { isAddress, verifyMessage, createPublicClient, http, formatEther } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { SiweMessage } from 'siwe'
import { ParsedMessage } from '@spruceid/siwe-parser'
import rateLimit from 'express-rate-limit'
import Redis from 'ioredis' // optional for nonce (fallback to memory if unavailable)
import mongoose from 'mongoose' // optional for logs (fallback to file if unavailable)
import { appendFile, readFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()

app.set('trust proxy', 1)

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
let mongoReady = false
if (process.env.MONGO_URI) {
  mongoose.connection.on('connected', () => {
    mongoReady = true
  })
  mongoose.connection.on('disconnected', () => {
    mongoReady = false
  })
  mongoose.connection.on('error', () => {
    mongoReady = false
  })

  const ActivityLogSchema = new mongoose.Schema({
    type: { type: String, required: true, enum: ['login', 'disconnect', 'transaction'] },
    address: { type: String, required: true, index: true },
    balance: { type: String },
    chainId: { type: Number },
    connectorName: { type: String },
    txHash: { type: String },
    fromAddress: { type: String },
    toAddress: { type: String },
    amountEth: { type: String },
    blockNumber: { type: Number },
    kind: { type: String },
    tokenAddress: { type: String },
    tokenAmount: { type: String },
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

// Public clients for balance lookups (per chain). Sepolia default avoids rpc.sepolia.org (often slow/timeout).
const rpcByChain = {
  [mainnet.id]: process.env.RPC_URL || 'https://eth.llamarpc.com',
  [sepolia.id]: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
}
const publicClients = {
  [mainnet.id]: createPublicClient({ chain: mainnet, transport: http(rpcByChain[mainnet.id]) }),
  [sepolia.id]: createPublicClient({ chain: sepolia, transport: http(rpcByChain[sepolia.id]) }),
}
function getPublicClient(chainId) {
  return publicClients[chainId] ?? publicClients[mainnet.id]
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ ok: false, error: 'Not logged in' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const isWallet = typeof payload.sub === 'string' && payload.sub.startsWith('0x') && isAddress(payload.sub)
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

const NONCE_TTL_SECONDS = 720 // 12 minutes (must match or exceed SIWE_TTL_MS + SIWE_CLOCK_SKEW_MS to prevent nonce expiry before message expiry)
const nonceMemory = new Map()

const getNonceKey = (address, nonce) => `nonce:${address.toLowerCase()}:${nonce}`

// SIWE EIP-4361 requires nonce to be 8*( ALPHA / DIGIT ) — alphanumeric only (no hyphens)
function generateSiweNonce() {
  return randomBytes(16).toString('hex')
}

async function issueNonce(address) {
  const nonce = generateSiweNonce()
  const key = getNonceKey(address, nonce)

  if (redis) {
    await redis.set(key, nonce, 'EX', NONCE_TTL_SECONDS)
  } else {
    const expiresAt = Date.now() + NONCE_TTL_SECONDS * 1000
    nonceMemory.set(key, { nonce, expiresAt })
  }

  return { nonce, expiresAt: Date.now() + NONCE_TTL_SECONDS * 1000 }
}

async function takeNonce(address, nonce) {
  const key = getNonceKey(address, nonce)

  if (redis) {
    // Atomic get-and-delete so two concurrent verifies cannot consume the same nonce
    const stored = await redis.getdel(key)
    return stored === nonce ? nonce : null
  }

  const entry = nonceMemory.get(key)
  nonceMemory.delete(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) return null
  return entry.nonce === nonce ? nonce : null
}

// Periodic cleanup of expired in-memory nonces (when Redis is not used)
if (!redis) {
  const NONCE_CLEANUP_INTERVAL_MS = 60 * 1000
  setInterval(() => {
    const now = Date.now()
    const toDelete = []
    for (const [key, entry] of nonceMemory.entries()) {
      if (now > entry.expiresAt) toDelete.push(key)
    }
    for (const key of toDelete) nonceMemory.delete(key)
  }, NONCE_CLEANUP_INTERVAL_MS)
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
const ALLOWED_CHAIN_IDS = new Set([mainnet.id, sepolia.id])

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
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// API: SIWE Message (Sign-In With Ethereum)
app.get('/api/siwe/message', authLimiter, async (req, res) => {
  const address = String(req.query.address ?? '')
  const chainId = Number(req.query.chainId ?? mainnet.id)
  const uri = String(req.query.uri ?? '')

  if (!isAddress(address)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  const chainIdInt = Number.isFinite(chainId) ? Math.floor(chainId) : mainnet.id
  if (!ALLOWED_CHAIN_IDS.has(chainIdInt)) return res.status(400).json({ ok: false, error: 'Unsupported chainId' })

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
      chainId: chainIdInt,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expirationTime.toISOString(),
      notBefore: issuedAt.toISOString(),
    })
  
    return res.json({ ok: true, message: msg.prepareMessage(), nonce })
  } catch (err) {
    console.error('SIWE generation error:', err)
    return res.status(500).json({ ok: false, error: 'Internal error' })
  }
})

// API: SIWE Verify
app.post('/api/siwe/verify', strictAuthLimiter, async (req, res) => {
  const { message, signature } = req.body ?? {}
  if (!message || !signature) return res.status(400).json({ ok: false, error: 'Missing data' })
  if (typeof message !== 'string') return res.status(400).json({ ok: false, error: 'Invalid SIWE message: expected EIP-4361 string' })

  let siwe
  try {
    const parsed = new ParsedMessage(message)
    siwe = new SiweMessage({
      scheme: parsed.scheme,
      domain: parsed.domain,
      address: parsed.address,
      statement: parsed.statement,
      uri: parsed.uri,
      version: parsed.version,
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      issuedAt: parsed.issuedAt,
      expirationTime: parsed.expirationTime,
      notBefore: parsed.notBefore,
      requestId: parsed.requestId,
      resources: parsed.resources,
    })
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid SIWE message' })
  }

  // Standard SIWE field checks 
  if (siwe.version !== '1') return res.status(400).json({ ok: false, error: 'Invalid SIWE version' })
  if (siwe.statement !== SIWE_STATEMENT) return res.status(400).json({ ok: false, error: 'Invalid SIWE statement' })
  if (!isAddress(siwe.address)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  const verifyChainId = Number(siwe.chainId)
  const verifyChainIdInt = Number.isFinite(verifyChainId) ? Math.floor(verifyChainId) : 0
  if (!ALLOWED_CHAIN_IDS.has(verifyChainIdInt)) return res.status(400).json({ ok: false, error: 'Unsupported chainId' })

  // Validate expected frontend origin/domain (must match CORS: 5170-5179 in dev)
  const allowedOrigins = new Set()
  if (process.env.WEB_ORIGIN) allowedOrigins.add(process.env.WEB_ORIGIN)
  if (!IS_PROD) {
    for (let p = 5170; p <= 5179; p++) {
      allowedOrigins.add(`http://localhost:${p}`)
      allowedOrigins.add(`http://127.0.0.1:${p}`)
    }
  }

  if (IS_PROD && allowedOrigins.size === 0) {
    return res.status(503).json({ ok: false, error: 'Server misconfiguration: WEB_ORIGIN required in production' })
  }

  let msgOrigin
  try {
    msgOrigin = new URL(siwe.uri).origin
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid uri in SIWE message' })
  }
  if (!allowedOrigins.has(msgOrigin)) {
    return res.status(400).json({ ok: false, error: `Invalid origin: ${msgOrigin}` })
  }
  const expectedDomain = new URL(msgOrigin).host
  if (siwe.domain !== expectedDomain) {
    return res.status(400).json({ ok: false, error: 'SIWE domain mismatch' })
  }

  // Time window checks (prevents old/future messages)
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

  // Verify Nonce (Async now) - check the specific nonce from the signed message
  const nonceValid = await takeNonce(siwe.address, siwe.nonce)
  if (!nonceValid) return res.status(400).json({ ok: false, error: 'Missing/expired nonce. Request a new SIWE message.' })

  let verifyResult
  try {
    verifyResult = await siwe.verify({
      signature,
      domain: expectedDomain,
      nonce: siwe.nonce,
      time: new Date().toISOString(),
    })
  } catch (err) {
    console.error('SIWE verify threw:', err)
    return res.status(401).json({ ok: false, error: 'Invalid SIWE signature' })
  }

  if (!verifyResult.success) return res.status(401).json({ ok: false, error: 'Invalid SIWE signature' })

  // Balance check (on the chain from the SIWE message)
  let balanceEth = null
  const chainId = Number(siwe.chainId)
  try {
    const client = getPublicClient(chainId)
    const balance = await client.getBalance({ address: siwe.address })
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
app.post('/api/log-activity', requireAuth, async (req, res) => {
  const { type, address, balance, chainId, connectorName, txHash, fromAddress, toAddress, amountEth, blockNumber, kind, tokenAddress, tokenAmount } = req.body ?? {}
  if (!type) return res.status(400).json({ ok: false, error: 'Missing type' })
  // Require wallet-based auth so I never accept arbitrary body address (e.g. email-only JWT would have req.user.address = null)
  const authAddress = req.user?.address ?? null
  if (!authAddress) return res.status(403).json({ ok: false, error: 'Wallet address required to log activity' })
  const bodyAddress = address != null && address !== '' ? String(address).trim() : null
  const resolvedAddress = !bodyAddress || bodyAddress.toLowerCase() === authAddress.toLowerCase() ? authAddress : null
  if (!resolvedAddress) return res.status(403).json({ ok: false, error: 'Cannot log activity for another address' })
  if (!isAddress(resolvedAddress)) return res.status(400).json({ ok: false, error: 'Invalid address' })
  if (!['login', 'disconnect', 'transaction'].includes(type)) return res.status(400).json({ ok: false, error: 'Invalid type' })

  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  const userAgent = req.get('user-agent') || 'unknown'

  let logData = {
    type,
    address: resolvedAddress,
    balance: balance != null && balance !== '' ? String(balance) : null,
    chainId: chainId != null && Number.isFinite(Number(chainId)) ? Number(chainId) : null,
    connectorName: connectorName != null && String(connectorName).trim() ? String(connectorName).trim() : null,
    txHash: null,
    fromAddress: null,
    toAddress: null,
    amountEth: null,
    blockNumber: null,
    kind: kind != null && String(kind).trim() ? String(kind).trim() : null,
    tokenAddress: tokenAddress != null && String(tokenAddress).trim() ? String(tokenAddress).trim() : null,
    tokenAmount: tokenAmount != null && tokenAmount !== '' ? String(tokenAmount) : null,
    ip,
    userAgent,
  }

  // Transaction: require txHash; optionally fetch from RPC if from/to/amount not provided
  if (type === 'transaction') {
    const hash = typeof txHash === 'string' && txHash.startsWith('0x') ? txHash.trim() : null
    if (!hash) return res.status(400).json({ ok: false, error: 'Missing or invalid txHash for transaction' })
    const chainIdNum = logData.chainId != null ? logData.chainId : mainnet.id
    logData.txHash = hash
    logData.fromAddress = fromAddress != null && String(fromAddress).trim() ? String(fromAddress).trim() : null
    logData.toAddress = toAddress != null && String(toAddress).trim() ? String(toAddress).trim() : null
    logData.amountEth = amountEth != null && amountEth !== '' ? String(amountEth) : null
    logData.blockNumber = blockNumber != null && Number.isFinite(Number(blockNumber)) ? Number(blockNumber) : null

    if ((!logData.fromAddress || !logData.toAddress || logData.amountEth == null) && ALLOWED_CHAIN_IDS.has(chainIdNum)) {
      try {
        const client = getPublicClient(chainIdNum)
        const tx = await client.getTransaction({ hash: /** @type {import('viem').Hash} */ (hash) })
        if (tx) {
          if (!logData.fromAddress) logData.fromAddress = tx.from
          if (!logData.toAddress && tx.to) logData.toAddress = tx.to
          if (logData.amountEth == null && tx.value != null) logData.amountEth = formatEther(tx.value)
          if (logData.blockNumber == null && tx.blockNumber != null) logData.blockNumber = Number(tx.blockNumber)
        }
      } catch (err) {
        console.warn('Failed to fetch tx for log:', err.message)
      }
    }
  }

  try {
    let wroteToMongo = false
    if (ActivityLog && mongoReady) {
      try {
        await ActivityLog.create(logData)
        wroteToMongo = true
      } catch (err) {
        wroteToMongo = false
        console.error('MongoDB write failed; falling back to file log:', err)
      }
    }

    // Always append to activity.txt for transaction type; for login/disconnect append only when no Mongo
    const shouldAppendToFile = type === 'transaction' || !wroteToMongo
    if (shouldAppendToFile) {
      const now = new Date()
      const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
      const time = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const balanceLine = `Balance:         ${logData.balance != null ? logData.balance + ' ETH' : '—'}\n`
      const chainIdLine = `Chain ID:        ${logData.chainId != null ? logData.chainId : '—'}\n`
      const connectorLine = `Connector:       ${logData.connectorName != null ? logData.connectorName : '—'}\n`
      const kindLine = logData.kind ? `Kind:            ${logData.kind}\n` : ''
      const tokenLine = logData.tokenAddress ? `Token:           ${logData.tokenAddress}\nToken Amount:    ${logData.tokenAmount ?? '—'}\n` : ''
      const txLines =
        type === 'transaction'
          ? `Tx Hash:         ${logData.txHash ?? '—'}\nFrom:            ${logData.fromAddress ?? '—'}\nTo:              ${logData.toAddress ?? '—'}\nAmount:          ${logData.amountEth != null ? logData.amountEth + ' ETH' : '—'}\nBlock:           ${logData.blockNumber != null ? logData.blockNumber : '—'}\n${kindLine}${tokenLine}`
          : ''

      const statusLabel = type === 'login' ? 'Logged In' : type === 'disconnect' ? 'Disconnected' : (logData.kind || 'Transaction')
      if (await isLogFileEmpty()) {
        const header = `${'='.repeat(120)}
ACTIVITY LOG - Web3 Login System
${'='.repeat(120)}

`
        await appendFile(ACTIVITY_LOG_PATH, header)
      }

      const entry = `${'─'.repeat(80)}
Time:           ${date} ${time}
Status:         ${statusLabel}
Wallet Address: ${resolvedAddress}
${balanceLine}${chainIdLine}${connectorLine}${txLines}IP Address:     ${ip}
User Agent:     ${userAgent}
`
      await appendFile(ACTIVITY_LOG_PATH, entry)
    }
    return res.json({ ok: true })
  } catch (err) {
    console.error('Failed to write activity log:', err)
    return res.status(500).json({ ok: false, error: 'Logging failed' })
  }
})

// GET activity log (from MongoDB or parsed from activity.txt)
app.get('/api/activity', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const authAddress = req.user?.address ?? null
  const queryAddress = req.query.address ? String(req.query.address).trim().toLowerCase() : null
  const filterAddress = queryAddress && authAddress && queryAddress === authAddress.toLowerCase() ? queryAddress : authAddress
  if (!authAddress) return res.json({ ok: true, activity: [] })

  try {
    if (ActivityLog && mongoReady) {
      const query = filterAddress
        ? { address: { $regex: `^${filterAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
        : {}
      const docs = await ActivityLog.find(query).sort({ timestamp: -1 }).limit(limit).lean()
      const list = docs.map((d) => ({
        time: d.timestamp,
        status: d.type === 'login' ? 'Logged In' : d.type === 'disconnect' ? 'Disconnected' : (d.kind || 'Transaction'),
        address: d.address,
        balance: d.balance,
        chainId: d.chainId,
        connector: d.connectorName,
        txHash: d.txHash,
        from: d.fromAddress,
        to: d.toAddress,
        amountEth: d.amountEth,
        block: d.blockNumber,
        kind: d.kind,
        tokenAddress: d.tokenAddress,
        tokenAmount: d.tokenAmount,
      }))
      return res.json({ ok: true, activity: list })
    }

    // File fallback: read and parse activity.txt
    let content
    try {
      content = await readFile(ACTIVITY_LOG_PATH, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return res.json({ ok: true, activity: [] })
      throw err
    }
    const blocks = content.split(/\n[-─]{20,}\n/).filter((b) => b.trim())
    const list = []
    for (const block of blocks) {
      if (block.includes('ACTIVITY LOG -')) continue
      const entry = {}
      for (const line of block.split('\n')) {
        const colon = line.indexOf(':')
        if (colon <= 0) continue
        const key = line.slice(0, colon).trim().replace(/\s+/g, ' ')
        const value = line.slice(colon + 1).trim()
        if (key === 'Time') entry.time = value
        else if (key === 'Status') entry.status = value
        else if (key === 'Wallet Address') entry.address = value
        else if (key === 'Balance') entry.balance = value === '—' ? null : (value.replace(/\s*ETH$/, '').trim() || null)
        else if (key === 'Chain ID') entry.chainId = value === '—' ? null : Number(value) || null
        else if (key === 'Connector') entry.connector = value === '—' ? null : value
        else if (key === 'Tx Hash') entry.txHash = value === '—' ? null : value
        else if (key === 'From') entry.from = value === '—' ? null : value
        else if (key === 'To') entry.to = value === '—' ? null : value
        else if (key === 'Amount') entry.amountEth = value === '—' ? null : value.replace(/\s*ETH$/, '').trim()
        else if (key === 'Block') entry.block = value === '—' ? null : Number(value) || null
        else if (key === 'Kind') entry.kind = value === '—' ? null : value
        else if (key === 'Token') entry.tokenAddress = value === '—' ? null : value
        else if (key === 'Token Amount') entry.tokenAmount = value === '—' ? null : value
      }
      if (entry.address && (!filterAddress || entry.address.toLowerCase() === filterAddress)) list.push(entry)
    }
    list.reverse()
    res.json({ ok: true, activity: list.slice(0, limit) })
  } catch (err) {
    console.error('Failed to read activity log:', err)
    return res.status(500).json({ ok: false, error: 'Failed to load activity' })
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
  // Express 5 uses path-to-regexp v6, where bare "*" is invalid.
  // Use a regex to match all non-API routes and serve the SPA index.html.
  app.get(/^(?!\/api).*/, (req, res, next) => {
    res.sendFile(join(distPath, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}
// ------------------------------------------------------------------

const port = Number(process.env.PORT ?? 3001)

// Start server immediately; MongoDB connects in background so file fallback works without blocking startup
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI).then(() => {
    mongoReady = true
    console.log('Connected to MongoDB')
  }).catch((err) => {
    console.error('MongoDB connection error:', err)
  })
}
app.listen(port, () => {
  console.log(`Auth API listening on http://127.0.0.1:${port}`)
})
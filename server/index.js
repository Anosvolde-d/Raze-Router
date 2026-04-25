import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createReadStream, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import pg from 'pg'
import { createClient } from 'redis'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

function loadLocalEnv() {
  try {
    const env = readFileSync(path.join(rootDir, '.env'), 'utf8')
    for (const line of env.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const splitAt = trimmed.indexOf('=')
      if (splitAt === -1) continue
      const key = trimmed.slice(0, splitAt).trim()
      const value = trimmed.slice(splitAt + 1).trim().replace(/^['"]|['"]$/g, '')
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // Railway injects env vars directly; local .env is optional.
  }
}

loadLocalEnv()

const dataDir = process.env.RAZE_DATA_DIR || path.join(rootDir, '.data')
const dataFile = process.env.RAZE_DATA_FILE || path.join(dataDir, 'raze-store.json')
const port = Number(process.env.PORT || 3000)
const adminKey = process.env.RAZE_ADMIN_KEY || ''
const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || ''
const redisUrl = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || ''
const providerSecrets = new Map()
const rateBuckets = new Map()
const tokenBuckets = new Map()
const maxBodyBytes = Number(process.env.RAZE_MAX_BODY_BYTES || 1_000_000)
const maxRequestsPerMinute = Number(process.env.RAZE_RATE_LIMIT_PER_MINUTE || 60)
const maxTokensPerMinute = Number(process.env.RAZE_TOKEN_LIMIT_PER_MINUTE || 200_000)
const cacheNamespace = process.env.RAZE_CACHE_NAMESPACE || 'raze:cache'
const cacheEnabled = String(process.env.RAZE_CACHE_ENABLED || 'true').toLowerCase() !== 'false'
const metricsEnabled = String(process.env.RAZE_ENABLE_METRICS || 'true').toLowerCase() !== 'false'
const logLevel = process.env.LOG_LEVEL || 'info'
const googleClientId = process.env.GOOGLE_CLIENT_ID || ''
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || ''
const corsOrigin = (process.env.RAZE_CORS_ORIGIN || '').trim()
let pgPool
let redisClient
let warnedAboutCors = false

const metrics = {
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  providerErrors: 0,
  upstreamLatencyMsTotal: 0,
  upstreamLatencyMsCount: 0,
  statusCounts: new Map()
}

const defaultStore = {
  models: [],
  audit: [],
  users: [],
  sessions: [],
  userKeys: [],
  requestLogs: [],
  incidents: [],
  oauthStates: []
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
}

function logEvent(level, event, details = {}) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 }
  const current = levels[logLevel] ?? 2
  const incoming = levels[level] ?? 2
  if (incoming > current) return
  const payload = { ts: new Date().toISOString(), level, event, ...details }
  const line = JSON.stringify(payload)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function recordMetricStatus(status) {
  const key = String(status)
  metrics.statusCounts.set(key, (metrics.statusCounts.get(key) || 0) + 1)
}

function trackRequestMetrics(status, latencyMs) {
  metrics.requests += 1
  recordMetricStatus(status)
  if (Number.isFinite(latencyMs)) {
    metrics.upstreamLatencyMsTotal += latencyMs
    metrics.upstreamLatencyMsCount += 1
  }
}

function buildPrometheusMetrics() {
  const lines = [
    '# HELP raze_requests_total Total number of handled upstream requests',
    '# TYPE raze_requests_total counter',
    `raze_requests_total ${metrics.requests}`,
    '# HELP raze_cache_hits_total Total number of cache hits',
    '# TYPE raze_cache_hits_total counter',
    `raze_cache_hits_total ${metrics.cacheHits}`,
    '# HELP raze_cache_misses_total Total number of cache misses',
    '# TYPE raze_cache_misses_total counter',
    `raze_cache_misses_total ${metrics.cacheMisses}`,
    '# HELP raze_provider_errors_total Total provider error responses',
    '# TYPE raze_provider_errors_total counter',
    `raze_provider_errors_total ${metrics.providerErrors}`,
    '# HELP raze_upstream_latency_ms_average Average upstream latency in milliseconds',
    '# TYPE raze_upstream_latency_ms_average gauge',
    `raze_upstream_latency_ms_average ${metrics.upstreamLatencyMsCount ? (metrics.upstreamLatencyMsTotal / metrics.upstreamLatencyMsCount).toFixed(2) : 0}`
  ]
  for (const [status, count] of metrics.statusCounts.entries()) {
    lines.push(`raze_response_status_total{status="${status}"} ${count}`)
  }
  return `${lines.join('\n')}\n`
}

async function readStore() {
  const cached = await readRedisStore()
  if (cached) return normalizeStoreSecrets(cached)

  const postgres = await readPostgresStore()
  if (postgres) {
    const normalized = await normalizeStoreSecrets(postgres)
    await writeRedisStore(normalized)
    return normalized
  }

  try {
    return normalizeStoreSecrets(JSON.parse(await readFile(dataFile, 'utf8')))
  } catch {
    await writeStore(defaultStore)
    return structuredClone(defaultStore)
  }
}

async function normalizeStoreSecrets(store) {
  let changed = false
  const models = await Promise.all((store.models || []).map(async (model) => {
    const label = model.providerConfig?.apiKeyLabel || ''
    if (!isLikelyRawSecret(label)) return model
    const safeName = secretNameForModel(model)
    await saveProviderSecret(safeName, label)
    changed = true
    return { ...model, providerConfig: { ...model.providerConfig, apiKeyLabel: safeName } }
  }))
  const normalized = {
    ...store,
    models,
    users: store.users || [],
    sessions: store.sessions || [],
    userKeys: normalizeUserKeys(store.userKeys || []),
    requestLogs: store.requestLogs || [],
    incidents: store.incidents || [],
    oauthStates: store.oauthStates || []
  }
  if (changed) await writeStore(normalized)
  return normalized
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex')
}

function keyFingerprint(key) {
  return `${key.slice(0, 8)}...${key.slice(-6)}`
}

function safeCompare(a = '', b = '') {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function normalizeUserKeys(keys = []) {
  return keys.map((item) => {
    if (item.keyHash) return { ...item, key: undefined }
    if (!item.key) return item
    return { ...item, keyHash: hashApiKey(item.key), fingerprint: item.fingerprint || keyFingerprint(item.key), key: undefined }
  })
}

function publicUser(user) {
  if (!user) return undefined
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarStored ? `/api/profile/avatar/${user.id}` : user.avatarUrl,
    authMethod: user.authMethod || 'local',
    emailVerified: Boolean(user.emailVerified),
    banned: Boolean(user.banned),
    createdAt: user.createdAt
  }
}

function getSessionToken(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Session ')) return auth.slice(8).trim()
  return req.headers['x-session-token'] || ''
}

function authenticateSession(req, store) {
  const token = getSessionToken(req)
  if (!token) return undefined
  const session = (store.sessions || []).find((item) => item.tokenHash && safeCompare(item.tokenHash, hashApiKey(token)))
  const user = session ? (store.users || []).find((item) => item.id === session.userId) : undefined
  if (!session || !user || user.banned) return undefined
  return { token, session, user }
}

function appOrigin(req) {
  const forwardedProto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`
  return `${forwardedProto}://${host}`
}

function authRedirectUri(req) {
  return googleRedirectUri || `${appOrigin(req)}/auth`
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() })
  res.end(html)
}

function redirect(res, location) {
  res.writeHead(302, { location, ...corsHeaders() })
  res.end()
}

async function startGoogleAuth(req, res) {
  if (!googleClientId || !googleClientSecret) return sendJson(res, 500, { error: { message: 'google_oauth_not_configured', type: 'auth_config_missing' } })
  const store = await readStore()
  const state = crypto.randomBytes(24).toString('base64url')
  const now = Date.now()
  const saved = {
    ...store,
    oauthStates: [{ stateHash: hashApiKey(state), createdAt: new Date().toISOString(), expiresAt: new Date(now + 10 * 60_000).toISOString() }, ...(store.oauthStates || []).filter((item) => new Date(item.expiresAt).getTime() > now)].slice(0, 200)
  }
  await writeStore(saved)
  const params = new URLSearchParams({ client_id: googleClientId, redirect_uri: authRedirectUri(req), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' })
  return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}

async function completeGoogleAuth(req, res, url) {
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  if (!code || !state) return redirect(res, '/?auth=missing_code')
  if (!googleClientId || !googleClientSecret) return redirect(res, '/?auth=not_configured')

  const store = await readStore()
  const now = Date.now()
  const stateHash = hashApiKey(state)
  const stateRecord = (store.oauthStates || []).find((item) => item.stateHash && safeCompare(item.stateHash, stateHash) && new Date(item.expiresAt).getTime() > now)
  if (!stateRecord) return redirect(res, '/?auth=invalid_state')

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: googleClientId, client_secret: googleClientSecret, redirect_uri: authRedirectUri(req), grant_type: 'authorization_code' })
  })
  if (!tokenResponse.ok) return redirect(res, '/?auth=token_failed')
  const tokenData = await tokenResponse.json()
  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokenData.access_token}` } })
  if (!userResponse.ok) return redirect(res, '/?auth=userinfo_failed')
  const profile = await userResponse.json()
  if (!profile.email || !profile.email_verified) return redirect(res, '/?auth=email_unverified')

  const freshStore = await readStore()
  const existing = (freshStore.users || []).find((user) => user.googleId === profile.sub || user.email === String(profile.email).toLowerCase())
  if (existing?.banned) return redirect(res, '/?auth=banned')
  const token = `rs_${crypto.randomBytes(24).toString('base64url')}`
  const session = { id: crypto.randomUUID(), userId: existing?.id || crypto.randomUUID(), tokenHash: hashApiKey(token), createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }
  const user = existing ? {
    ...existing,
    googleId: sanitizeText(profile.sub),
    email: sanitizeText(profile.email).toLowerCase(),
    username: sanitizeText(profile.name || profile.email),
    avatarUrl: existing.avatarStored ? existing.avatarUrl : sanitizeUrl(profile.picture),
    authMethod: 'google',
    emailVerified: true,
    updatedAt: new Date().toISOString()
  } : {
    id: session.userId,
    googleId: sanitizeText(profile.sub),
    email: sanitizeText(profile.email).toLowerCase(),
    username: sanitizeText(profile.name || profile.email),
    avatarUrl: sanitizeUrl(profile.picture),
    avatarStored: false,
    authMethod: 'google',
    emailVerified: true,
    banned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  const saved = {
    ...freshStore,
    users: existing ? (freshStore.users || []).map((item) => item.id === user.id ? user : item) : [user, ...(freshStore.users || [])],
    sessions: [session, ...(freshStore.sessions || [])].slice(0, 500),
    oauthStates: (freshStore.oauthStates || []).filter((item) => item.stateHash !== stateRecord.stateHash && new Date(item.expiresAt).getTime() > now)
  }
  await writeStore(saved)
  return sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>RAZE Auth</title></head><body><script>localStorage.setItem('raze.user.session', ${JSON.stringify(token)}); location.replace('/?auth=success');</script><p>Authentication complete. Returning to RAZE...</p></body></html>`)
}

function normalizeAvatarUpload(body) {
  const dataUrl = String(body?.dataUrl || '')
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) return undefined
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
  const data = Buffer.from(match[3], 'base64')
  if (!data.length || data.length > 750_000) return undefined
  return { mimeType, data: data.toString('base64'), size: data.length, updatedAt: new Date().toISOString() }
}

function isLikelyRawSecret(value = '') {
  return /^(sk-|sk_|eyJ|AIza|xox[baprs]-)/.test(value) || (value.length > 40 && !/^[A-Z0-9_]+$/.test(value))
}

function secretNameForModel(model) {
  return `RAZE_${String(model.id || model.name || 'MODEL').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase()}_KEY`
}

function redactStore(store) {
  return {
    ...store,
    models: (store.models || []).map((model) => ({
      ...model,
      providerConfig: {
        ...model.providerConfig,
        apiKeyLabel: isLikelyRawSecret(model.providerConfig?.apiKeyLabel) ? secretNameForModel(model) : model.providerConfig?.apiKeyLabel,
        openAIBaseUrl: model.providerConfig?.openAIBaseUrl ? '[configured]' : '',
        anthropicEndpoint: model.providerConfig?.anthropicEndpoint ? '[configured]' : ''
      }
    }))
  }
}

function publicModel(model) {
  const { providerConfig, ...safe } = model
  return {
    ...safe,
    providerConfig: {
      provider: providerConfig?.provider || 'OpenAI Compatible',
      cacheMode: providerConfig?.cacheMode || 'Off'
    }
  }
}

function adminStore(store) {
  return {
    ...redactStore(store),
    userKeys: (store.userKeys || []).map((key) => ({ ...key, keyHash: undefined, key: key.fingerprint || 'stored securely' })),
    sessions: undefined,
    users: store.users || [],
    requestLogs: store.requestLogs || [],
    incidents: store.incidents || []
  }
}

async function writeStore(store) {
  await writePostgresStore(store)
  await writeRedisStore(store)
  await mkdir(path.dirname(dataFile), { recursive: true })
  await writeFile(dataFile, JSON.stringify(store, null, 2))
}

function scheduleBackground(task, meta = {}) {
  setImmediate(async () => {
    try {
      await task()
    } catch (error) {
      logEvent('error', 'background_task_failed', { ...meta, message: error instanceof Error ? error.message : 'unknown_error' })
    }
  })
}

async function getPgPool() {
  if (!databaseUrl) return undefined
  if (!pgPool) pgPool = new pg.Pool({ connectionString: databaseUrl })
  await pgPool.query('create table if not exists raze_config (id text primary key, data jsonb not null, updated_at timestamptz not null default now())')
  return pgPool
}

async function readPostgresStore() {
  try {
    const pool = await getPgPool()
    if (!pool) return undefined
    const result = await pool.query('select data from raze_config where id = $1', ['main'])
    return result.rows[0]?.data
  } catch (error) {
    logEvent('warn', 'postgres_unavailable', { message: error.message })
    return undefined
  }
}

async function writePostgresStore(store) {
  try {
    const pool = await getPgPool()
    if (!pool) return
    await pool.query('insert into raze_config (id, data, updated_at) values ($1, $2, now()) on conflict (id) do update set data = excluded.data, updated_at = now()', ['main', store])
  } catch (error) {
    logEvent('warn', 'postgres_write_failed', { message: error.message })
  }
}

async function getRedisClient() {
  if (!redisUrl) return undefined
  if (!redisClient) {
    redisClient = createClient({ url: redisUrl })
    redisClient.on('error', (error) => logEvent('warn', 'redis_error', { message: error.message }))
    await redisClient.connect()
  }
  return redisClient
}

async function readRedisStore() {
  try {
    const client = await getRedisClient()
    if (!client) return undefined
    const value = await client.get('raze:config')
    if (!value) return undefined
    const parsed = JSON.parse(value)
    if ((parsed.models || []).some((model) => isLikelyRawSecret(model.providerConfig?.apiKeyLabel))) return undefined
    return parsed
  } catch (error) {
    logEvent('warn', 'redis_unavailable', { message: error.message })
    return undefined
  }
}

async function writeRedisStore(store) {
  try {
    const client = await getRedisClient()
    if (!client) return
    await client.set('raze:config', JSON.stringify(store))
  } catch (error) {
    logEvent('warn', 'redis_write_failed', { message: error.message })
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(), ...extraHeaders })
  res.end(JSON.stringify(body))
}

function corsHeaders(req) {
  const requestOrigin = req?.headers?.origin || ''
  if (!corsOrigin) {
    if (!warnedAboutCors) {
      warnedAboutCors = true
      logEvent('warn', 'cors_origin_missing', { message: 'RAZE_CORS_ORIGIN is not set. Browser cross-origin requests are denied by default.' })
    }
    return {
      'access-control-allow-origin': 'null',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type,Authorization,X-Admin-Key,X-Session-Token,X-Api-Key'
    }
  }
  const allowedOrigin = requestOrigin && requestOrigin === corsOrigin ? requestOrigin : corsOrigin
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Authorization,X-Admin-Key,X-Session-Token,X-Api-Key'
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body) > maxBodyBytes) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      if (!body) return resolve({})
      try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
}

function touchRateBucket(map, key, amount = 1, limit = maxRequestsPerMinute) {
  const now = Date.now()
  const bucket = map.get(key) || { count: 0, resetAt: now + 60_000 }
  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + 60_000
  }
  bucket.count += amount
  map.set(key, bucket)
  return { ok: bucket.count <= limit, resetAt: bucket.resetAt, remaining: Math.max(0, limit - bucket.count), used: bucket.count }
}

function checkRateLimit(key) {
  return touchRateBucket(rateBuckets, key, 1, maxRequestsPerMinute)
}

function checkTokenLimit(key, tokens) {
  return touchRateBucket(tokenBuckets, key, tokens, maxTokensPerMinute)
}

function isAdmin(req) {
  if (!adminKey) return false
  const auth = req.headers.authorization || ''
  const key = req.headers['x-admin-key'] || ''
  return auth === `Bearer ${adminKey}` || key === adminKey
}

function publicModels(store) {
  return store.models.filter((model) => model.visibility !== 'Hidden' && model.visibility !== 'Staff Only').map(publicModel)
}

function openAiModelList(store) {
  return {
    object: 'list',
    data: publicModels(store).map((model) => ({
      id: model.id,
      object: 'model',
      created: Math.floor(new Date(model.added || Date.now()).getTime() / 1000),
      owned_by: 'raze',
      name: model.name,
      status: model.status,
      capabilities: model.capabilities || [],
      max_context: model.maxContext
    }))
  }
}

function findRoute(store, id) {
  return store.models.find((model) => model.id === id || model.providerConfig?.modelId === id)
}

function flattenMessageContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item
      if (item?.type === 'text') return item.text || ''
      return JSON.stringify(item)
    }).join('\n')
  }
  if (!content) return ''
  return JSON.stringify(content)
}

function tokenEstimateFromMessages(messages = []) {
  const text = messages.map((message) => flattenMessageContent(message.content)).join('\n')
  return Math.ceil(text.length / 4)
}

function getBearerKey(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return req.headers['x-api-key'] || ''
}

async function authenticateUserKey(req, store) {
  const key = getBearerKey(req)
  if (!key || !key.startsWith('rz_')) return undefined
  const keyHash = hashApiKey(key)
  const record = (store.userKeys || []).find((item) => item.active !== false && safeCompare(item.keyHash || hashApiKey(item.key || ''), keyHash))
  const user = record ? (store.users || []).find((item) => item.id === record.userId) : undefined
  if (!record || !user || user.banned) return undefined
  return { keyHash, record, user }
}

function createUserKey(label = 'Default key') {
  const key = `rz_${crypto.randomBytes(24).toString('base64url')}`
  return { id: crypto.randomUUID(), key, keyHash: hashApiKey(key), fingerprint: keyFingerprint(key), label, active: true, createdAt: new Date().toISOString(), lastUsedAt: null, requestCount: 0 }
}

function createUserKeyForUser(userId, label = 'Default key') {
  return { ...createUserKey(label), userId }
}

function persistableUserKey(key) {
  const { key: plaintext, ...safe } = key
  return safe
}

async function touchUserKey(store, keyHash) {
  const next = { ...store, userKeys: (store.userKeys || []).map((item) => safeCompare(item.keyHash || hashApiKey(item.key || ''), keyHash) ? { ...item, key: undefined, keyHash: item.keyHash || hashApiKey(item.key || ''), fingerprint: item.fingerprint || (item.key ? keyFingerprint(item.key) : undefined), lastUsedAt: new Date().toISOString(), requestCount: (item.requestCount || 0) + 1 } : item) }
  await writeStore(next)
}

async function writeRequestLog(store, log) {
  const next = { ...store, requestLogs: [{ id: crypto.randomUUID(), at: new Date().toISOString(), ...log }, ...(store.requestLogs || [])].slice(0, 500) }
  await writeStore(next)
}

function tokenEstimateFromResponseText(text = '') {
  return Math.ceil(String(text).length / 4)
}

function createIncident(store, details) {
  const code = `RZ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  const incident = { code, at: new Date().toISOString(), ...details }
  return { code, store: { ...store, incidents: [incident, ...(store.incidents || [])].slice(0, 200) } }
}

function providerTarget(model, kind) {
  const provider = model.providerConfig || {}
  if (provider.provider === 'Anthropic' || kind === 'messages') {
    return provider.anthropicEndpoint || 'https://api.anthropic.com/v1/messages'
  }
  const base = (provider.openAIBaseUrl || '').replace(/\/$/, '')
  return `${base || 'https://api.openai.com/v1'}/chat/completions`
}

function sanitizeText(value, fallback = '') {
  return String(value ?? fallback).slice(0, 500)
}

function sanitizeUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : ''
  } catch {
    return ''
  }
}

function sanitizeModel(model) {
  const providerConfig = model.providerConfig || {}
  return {
    id: sanitizeText(model.id).replace(/[^a-zA-Z0-9._:/-]/g, '').slice(0, 160),
    name: sanitizeText(model.name || model.id || 'Unnamed model'),
    description: sanitizeText(model.description),
    maxContext: Math.max(1, Math.min(Number(model.maxContext || 8192), 2_000_000)),
    status: ['Online', 'Offline', 'Coming Soon', 'Degraded'].includes(model.status) ? model.status : 'Offline',
    firstToken: Number(model.firstToken || 0),
    capabilities: Array.isArray(model.capabilities) ? model.capabilities.slice(0, 16) : [],
    tags: Array.isArray(model.tags) ? model.tags.map((item) => sanitizeText(item)).slice(0, 30) : [],
    groups: Array.isArray(model.groups) ? model.groups.map((item) => sanitizeText(item)).slice(0, 30) : [],
    featured: Boolean(model.featured),
    popularity: Number(model.popularity || 0),
    added: sanitizeText(model.added || new Date().toISOString().slice(0, 10)),
    videoUrl: sanitizeUrl(model.videoUrl),
    gradient: sanitizeText(model.gradient || 'linear-gradient(135deg, #050505, #6e5afd)'),
    hoverDescription: sanitizeText(model.hoverDescription),
    visibility: ['Public', 'Hidden', 'Staff Only', 'Preview'].includes(model.visibility) ? model.visibility : 'Hidden',
    launchAvailable: Boolean(model.launchAvailable),
    sortPriority: Number(model.sortPriority || 999),
    providerConfig: {
      provider: ['OpenAI Compatible', 'Anthropic', 'Custom'].includes(providerConfig.provider) ? providerConfig.provider : 'OpenAI Compatible',
      modelId: sanitizeText(providerConfig.modelId),
      openAIBaseUrl: sanitizeUrl(providerConfig.openAIBaseUrl),
      anthropicEndpoint: sanitizeUrl(providerConfig.anthropicEndpoint),
      apiKeyLabel: isLikelyRawSecret(providerConfig.apiKeyLabel) ? providerConfig.apiKeyLabel : sanitizeText(providerConfig.apiKeyLabel || 'RAZE_PROVIDER_KEY').replace(/[^A-Z0-9_]/gi, '_').toUpperCase(),
      cacheMode: ['Off', 'Anthropic Prompt Cache', 'OpenAI Compatible Cache', 'Hybrid'].includes(providerConfig.cacheMode) ? providerConfig.cacheMode : 'Off',
      cacheTtlSeconds: Math.max(0, Math.min(Number(providerConfig.cacheTtlSeconds || 0), 86400)),
      cacheSystemPrompt: Boolean(providerConfig.cacheSystemPrompt),
      cacheTools: Boolean(providerConfig.cacheTools),
      cacheLargeContext: Boolean(providerConfig.cacheLargeContext)
    }
  }
}

function sanitizeStoreInput(store) {
  return {
    ...store,
    models: Array.isArray(store.models) ? store.models.map(sanitizeModel).filter((model) => model.id) : [],
    userKeys: normalizeUserKeys(store.userKeys || []),
    incidents: Array.isArray(store.incidents) ? store.incidents.slice(0, 200) : [],
    audit: Array.isArray(store.audit) ? store.audit.slice(0, 500) : [],
    oauthStates: Array.isArray(store.oauthStates) ? store.oauthStates.slice(0, 200) : []
  }
}

async function getProviderSecret(secretName) {
  if (isLikelyRawSecret(secretName)) return secretName
  if (process.env[secretName]) return process.env[secretName]
  if (providerSecrets.has(secretName)) return providerSecrets.get(secretName)
  try {
    const pool = await getPgPool()
    if (!pool) return undefined
    await pool.query('create table if not exists raze_secrets (name text primary key, value text not null, updated_at timestamptz not null default now())')
    const result = await pool.query('select value from raze_secrets where name = $1', [secretName])
    const value = result.rows[0]?.value
    if (value) providerSecrets.set(secretName, value)
    return value
  } catch (error) {
    logEvent('warn', 'secret_lookup_failed', { message: error.message })
    return undefined
  }
}

async function saveProviderSecret(secretName, value) {
  providerSecrets.set(secretName, value)
  const pool = await getPgPool()
  if (!pool) return { persisted: 'memory' }
  await pool.query('create table if not exists raze_secrets (name text primary key, value text not null, updated_at timestamptz not null default now())')
  await pool.query('insert into raze_secrets (name, value, updated_at) values ($1, $2, now()) on conflict (name) do update set value = excluded.value, updated_at = now()', [secretName, value])
  return { persisted: 'postgres' }
}

function makeCacheKey(model, body) {
  const messages = body.messages || []
  const key = JSON.stringify({
    model: model.id,
    providerModel: model.providerConfig?.modelId || model.id,
    messages,
    system: body.system,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens,
    tools: body.tools,
    attachments: body.attachments
  })
  return `${cacheNamespace}:${hashApiKey(key)}`
}

async function readCachedResponse(cacheKey) {
  if (!cacheEnabled) return undefined
  try {
    const client = await getRedisClient()
    if (!client) return undefined
    const value = await client.get(cacheKey)
    if (!value) {
      metrics.cacheMisses += 1
      return undefined
    }
    metrics.cacheHits += 1
    return JSON.parse(value)
  } catch (error) {
    logEvent('warn', 'cache_read_failed', { message: error.message })
    return undefined
  }
}

async function writeCachedResponse(cacheKey, ttlSeconds, payload) {
  if (!cacheEnabled || !ttlSeconds) return
  try {
    const client = await getRedisClient()
    if (!client) return
    await client.set(cacheKey, JSON.stringify(payload), { EX: ttlSeconds })
  } catch (error) {
    logEvent('warn', 'cache_write_failed', { message: error.message })
  }
}

function anthropicMessagesFromOpenAi(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const systemChunks = []
  const anthropicMessages = []
  for (const message of messages) {
    const content = flattenMessageContent(message.content)
    if (message.role === 'system') {
      if (content) systemChunks.push(content)
      continue
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    anthropicMessages.push({ role, content: [{ type: 'text', text: content }] })
  }
  return {
    model: body.model,
    max_tokens: Number(body.max_tokens || 1024),
    temperature: body.temperature,
    top_p: body.top_p,
    system: systemChunks.join('\n\n') || undefined,
    messages: anthropicMessages.length ? anthropicMessages : [{ role: 'user', content: [{ type: 'text', text: '' }] }],
    stream: Boolean(body.stream)
  }
}

function extractAnthropicText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((item) => item?.type === 'text').map((item) => item.text || '').join('')
}

function normalizeAnthropicToOpenAi(payload, modelId) {
  const text = extractAnthropicText(payload?.content)
  const inputTokens = Number(payload?.usage?.input_tokens || 0)
  const outputTokens = Number(payload?.usage?.output_tokens || 0)
  return {
    id: payload?.id || `chatcmpl_${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: payload?.stop_reason || 'stop' }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens }
  }
}

function makeOpenAiStreamChunk(id, modelId, content, finishReason = null) {
  return `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }] })}\n\n`
}

async function streamAnthropicAsOpenAi(upstream, res, modelId, routeId, startedAt) {
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const responseId = `chatcmpl_${crypto.randomUUID()}`

  res.writeHead(200, {
    ...corsHeaders(),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-raze-route': routeId,
    'x-raze-latency-ms': String(Date.now() - startedAt)
  })

  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true })
    while (buffer.includes('\n\n')) {
      const splitAt = buffer.indexOf('\n\n')
      const rawEvent = buffer.slice(0, splitAt)
      buffer = buffer.slice(splitAt + 2)
      const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      const payload = dataLine.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload)
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullText += parsed.delta.text
          res.write(makeOpenAiStreamChunk(responseId, modelId, parsed.delta.text))
        }
        if (parsed.type === 'message_stop') {
          res.write(makeOpenAiStreamChunk(responseId, modelId, '', 'stop'))
          res.write('data: [DONE]\n\n')
          res.end()
          return { text: fullText }
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }

  res.write(makeOpenAiStreamChunk(responseId, modelId, '', 'stop'))
  res.write('data: [DONE]\n\n')
  res.end()
  return { text: fullText }
}

async function pipeOpenAiStream(upstream, res, routeId, startedAt) {
  res.writeHead(upstream.status, {
    ...corsHeaders(),
    'content-type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
    'cache-control': upstream.headers.get('cache-control') || 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-raze-route': routeId,
    'x-raze-latency-ms': String(Date.now() - startedAt)
  })
  for await (const chunk of upstream.body) {
    res.write(chunk)
  }
  res.end()
}

async function proxyCompletion(req, res, kind) {
  const body = await readBody(req)
  const store = await readStore()
  const auth = await authenticateUserKey(req, store)
  if (!auth) return sendJson(res, 401, { error: { message: 'Missing or invalid RAZE API key.', type: 'invalid_api_key' } })

  const rate = checkRateLimit(auth.record.id)
  if (!rate.ok) return sendJson(res, 429, { error: { message: 'Rate limit reached. Please slow down and try again shortly.', type: 'rate_limited', reset_at: new Date(rate.resetAt).toISOString() } })

  const modelId = body.model
  const model = findRoute(store, modelId)
  if (!model) return sendJson(res, 404, { error: { message: `Unknown model: ${modelId}`, type: 'model_not_found' } })
  if (model.status !== 'Online') return sendJson(res, 503, { error: { message: `Model is ${model.status}`, type: 'model_unavailable' } })

  const sentTokens = tokenEstimateFromMessages(body.messages || [])
  const tokenRate = checkTokenLimit(auth.record.id, sentTokens)
  if (!tokenRate.ok) return sendJson(res, 429, { error: { message: 'Token rate limit reached. Try again shortly.', type: 'token_rate_limited', reset_at: new Date(tokenRate.resetAt).toISOString() } })

  const maxContext = Number(model.maxContext || 0)
  if (maxContext && sentTokens > maxContext) {
    return sendJson(res, 400, { error: { message: `You sent approximately ${sentTokens} tokens, and this model only supports up to ${maxContext}. Please lower the context.`, type: 'context_length_exceeded', sent_tokens: sentTokens, max_context: maxContext } })
  }

  const provider = model.providerConfig || {}
  const secretName = provider.apiKeyLabel || 'RAZE_PROVIDER_KEY'
  const apiKey = await getProviderSecret(secretName)
  if (!apiKey) return sendJson(res, 500, { error: { message: 'Missing provider API key. Save it in Admin provider settings or configure the matching backend environment variable.', type: 'missing_provider_secret' } })

  const isAnthropic = provider.provider === 'Anthropic' || kind === 'messages'
  const target = providerTarget(model, kind)
  const outbound = isAnthropic
    ? anthropicMessagesFromOpenAi({ ...body, model: provider.modelId || model.id })
    : { ...body, model: provider.modelId || model.id }
  const headers = { 'content-type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = req.headers['anthropic-version'] || '2023-06-01'
    headers.accept = body.stream ? 'text/event-stream' : 'application/json'
  } else {
    headers.authorization = `Bearer ${apiKey}`
  }

  const cacheKey = !body.stream && provider.cacheMode !== 'Off' ? makeCacheKey(model, body) : ''
  const cacheTtlSeconds = Math.max(0, Number(provider.cacheTtlSeconds || 0))
  if (cacheKey) {
    const cached = await readCachedResponse(cacheKey)
    if (cached) {
      scheduleBackground(() => touchUserKey(store, auth.keyHash), { event: 'touch_user_key_cached' })
      scheduleBackground(() => writeRequestLog(store, { userId: auth.user.id, email: auth.user.email, username: auth.user.username, keyId: auth.record.id, model: model.id, status: 200, inputTokens: sentTokens, outputTokens: Number(cached?.usage?.completion_tokens || 0), totalTokens: Number(cached?.usage?.total_tokens || sentTokens), cacheHit: true }), { event: 'write_request_log_cached' })
      logEvent('info', 'completion_cache_hit', { model: model.id, userId: auth.user.id, keyId: auth.record.id })
      trackRequestMetrics(200, 0)
      return sendJson(res, 200, cached, { 'x-raze-cache': 'hit', 'x-raze-route': model.id })
    }
  }
  if (cacheKey) metrics.cacheMisses += 1

  const started = Date.now()
  let upstream
  try {
    upstream = await fetch(target, { method: 'POST', headers, body: JSON.stringify(outbound) })
  } catch (error) {
    metrics.providerErrors += 1
    const incident = createIncident(await readStore(), { model: model.id, provider: provider.provider || 'OpenAI Compatible', status: 0, upstream: error instanceof Error ? error.message : 'provider_fetch_failed', userKeyId: auth.record.id })
    scheduleBackground(() => writeStore(incident.store), { event: 'write_incident_store' })
    scheduleBackground(async () => writeRequestLog(await readStore(), { userId: auth.user.id, email: auth.user.email, username: auth.user.username, keyId: auth.record.id, model: model.id, status: 502, inputTokens: sentTokens, outputTokens: 0, totalTokens: sentTokens, incidentCode: incident.code }), { event: 'write_failed_request_log' })
    logEvent('error', 'provider_fetch_failed', { model: model.id, provider: provider.provider || 'OpenAI Compatible', keyId: auth.record.id, message: error instanceof Error ? error.message : 'unknown_error' })
    trackRequestMetrics(502, Date.now() - started)
    return sendJson(res, 502, { error: { message: `The router is unavailable for now. Error code ${incident.code}.`, type: 'router_unavailable', code: incident.code } })
  }

  if (!upstream.ok) {
    metrics.providerErrors += 1
    const providerText = await upstream.text()
    const incident = createIncident(await readStore(), { model: model.id, provider: provider.provider || 'OpenAI Compatible', status: upstream.status, upstream: providerText.slice(0, 8000), userKeyId: auth.record.id })
    scheduleBackground(() => writeStore(incident.store), { event: 'write_incident_store' })
    scheduleBackground(async () => writeRequestLog(await readStore(), { userId: auth.user.id, email: auth.user.email, username: auth.user.username, keyId: auth.record.id, model: model.id, status: 502, inputTokens: sentTokens, outputTokens: 0, totalTokens: sentTokens, incidentCode: incident.code }), { event: 'write_upstream_error_log' })
    logEvent('warn', 'provider_response_failed', { model: model.id, provider: provider.provider || 'OpenAI Compatible', keyId: auth.record.id, status: upstream.status })
    trackRequestMetrics(502, Date.now() - started)
    return sendJson(res, 502, { error: { message: `The router is unavailable for now. Error code ${incident.code}.`, type: 'router_unavailable', code: incident.code } })
  }

  scheduleBackground(() => touchUserKey(store, auth.keyHash), { event: 'touch_user_key' })

  if (body.stream) {
    if (isAnthropic) {
      const streamResult = await streamAnthropicAsOpenAi(upstream, res, model.id, model.id, started)
      const outputTokens = tokenEstimateFromResponseText(streamResult.text)
      checkTokenLimit(auth.record.id, outputTokens)
      scheduleBackground(async () => writeRequestLog(await readStore(), { userId: auth.user.id, email: auth.user.email, username: auth.user.username, keyId: auth.record.id, model: model.id, status: 200, inputTokens: sentTokens, outputTokens, totalTokens: sentTokens + outputTokens, streamed: true }), { event: 'write_stream_log' })
      logEvent('info', 'completion_streamed', { model: model.id, provider: provider.provider || 'OpenAI Compatible', userId: auth.user.id, keyId: auth.record.id, latencyMs: Date.now() - started, streamed: true, status: 200 })
      trackRequestMetrics(200, Date.now() - started)
      return
    }

    await pipeOpenAiStream(upstream, res, model.id, started)
    scheduleBackground(async () => writeRequestLog(await readStore(), { userId: auth.user.id, email: auth.user.email, username: auth.user.username, keyId: auth.record.id, model: model.id, status: upstream.status, inputTokens: sentTokens, outputTokens: 0, totalTokens: sentTokens, streamed: true }), { event: 'write_stream_log' })
    logEvent('info', 'completion_streamed', { model: model.id, provider: provider.provider || 'OpenAI Compatible', userId: auth.user.id, keyId: auth.record.id, latencyMs: Date.now() - started, streamed: true, status: upstream.status })
    trackRequestMetrics(upstream.status, Date.now() - started)
    return
  }

  const responseText = await upstream.text()
  const normalized = isAnthropic ? normalizeAnthropicToOpenAi(JSON.parse(responseText), model.id) : JSON.parse(responseText)
  const outputTokens = Number(normalized?.usage?.completion_tokens || normalized?.usage?.output_tokens || tokenEstimateFromResponseText(JSON.stringify(normalized)))
  checkTokenLimit(auth.record.id, outputTokens)

  if (cacheKey && cacheTtlSeconds > 0) {
    scheduleBackground(() => writeCachedResponse(cacheKey, cacheTtlSeconds, normalized), { event: 'write_cache' })
  }

  scheduleBackground(() => writeRequestLog(await readStore(), { userId: auth.user.id, email: auth.user.email, username: auth.user.username, keyId: auth.record.id, model: model.id, status: upstream.status, inputTokens: sentTokens, outputTokens, totalTokens: sentTokens + outputTokens }), { event: 'write_request_log' })
  logEvent('info', 'completion_finished', { model: model.id, provider: provider.provider || 'OpenAI Compatible', userId: auth.user.id, keyId: auth.record.id, latencyMs: Date.now() - started, status: upstream.status, inputTokens: sentTokens, outputTokens, totalTokens: sentTokens + outputTokens, cacheable: Boolean(cacheKey), streamed: false })
  trackRequestMetrics(upstream.status, Date.now() - started)
  res.writeHead(upstream.status, {
    ...corsHeaders(req),
    'content-type': 'application/json; charset=utf-8',
    'x-raze-route': model.id,
    'x-raze-latency-ms': String(Date.now() - started),
    'x-raze-cache': 'miss'
  })
  res.end(JSON.stringify(normalized))
}

async function handleAdmin(req, res, pathname) {
  if (!isAdmin(req)) return sendJson(res, 401, { error: 'admin_key_required' })
  const store = await readStore()

  if (req.method === 'GET' && pathname === '/api/admin/verify') return sendJson(res, 200, { ok: true })
  if (req.method === 'GET' && pathname === '/api/admin/config') return sendJson(res, 200, adminStore(store))
  if ((req.method === 'PUT' || req.method === 'POST') && pathname === '/api/admin/config') {
    const next = await readBody(req)
    const saved = await normalizeStoreSecrets(sanitizeStoreInput({ ...store, ...next, audit: [...(store.audit || []), { at: new Date().toISOString(), action: 'config_saved' }] }))
    await writeStore(saved)
    return sendJson(res, 200, adminStore(saved))
  }
  if (req.method === 'POST' && pathname === '/api/admin/test-route') {
    const { modelId } = await readBody(req)
    const model = findRoute(store, modelId)
    if (!model) return sendJson(res, 404, { ok: false, error: 'model_not_found' })
    const secretName = model.providerConfig?.apiKeyLabel || 'RAZE_PROVIDER_KEY'
    return sendJson(res, 200, {
      ok: Boolean(await getProviderSecret(secretName)),
      model: model.id,
      provider: model.providerConfig?.provider,
      secretName,
      secretPresent: Boolean(await getProviderSecret(secretName)),
      endpointConfigured: Boolean(providerTarget(model, 'chat'))
    })
  }
  if (req.method === 'POST' && pathname === '/api/admin/keys') {
    const { label } = await readBody(req)
    const adminUser = (store.users || []).find((user) => user.email === 'admin@local.raze') || { id: 'admin-local', email: 'admin@local.raze', username: 'Admin', avatarUrl: '', banned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const key = createUserKeyForUser(adminUser.id, label || 'Admin-created key')
    const saved = { ...store, userKeys: [persistableUserKey(key), ...(store.userKeys || [])] }
    if (!(store.users || []).some((user) => user.id === adminUser.id)) saved.users = [adminUser, ...(store.users || [])]
    await writeStore(saved)
    return sendJson(res, 200, key)
  }
  if (req.method === 'POST' && pathname.startsWith('/api/admin/users/')) {
    const userId = pathname.split('/')[4]
    const { banned, revokeKeys } = await readBody(req)
    const saved = {
      ...store,
      users: (store.users || []).map((user) => user.id === userId ? { ...user, banned: Boolean(banned), updatedAt: new Date().toISOString() } : user),
      userKeys: revokeKeys ? (store.userKeys || []).map((key) => key.userId === userId ? { ...key, active: false } : key) : store.userKeys
    }
    await writeStore(saved)
    return sendJson(res, 200, adminStore(saved))
  }
  if (req.method === 'POST' && pathname.startsWith('/api/admin/keys/')) {
    const keyId = pathname.split('/')[4]
    const { active } = await readBody(req)
    const saved = { ...store, userKeys: (store.userKeys || []).map((key) => key.id === keyId ? { ...key, active: Boolean(active) } : key) }
    await writeStore(saved)
    return sendJson(res, 200, adminStore(saved))
  }
  if (req.method === 'POST' && pathname === '/api/admin/maintenance') {
    const { clearModels, clearIncidents, clearKeys } = await readBody(req)
    const saved = {
      ...store,
      models: clearModels ? [] : store.models,
      incidents: clearIncidents ? [] : store.incidents,
      userKeys: clearKeys ? [] : store.userKeys,
      audit: [...(store.audit || []), { at: new Date().toISOString(), action: 'maintenance', clearModels: Boolean(clearModels), clearIncidents: Boolean(clearIncidents), clearKeys: Boolean(clearKeys) }]
    }
    await writeStore(saved)
    return sendJson(res, 200, adminStore(saved))
  }
  if (req.method === 'GET' && pathname.startsWith('/api/admin/incidents/')) {
    const code = pathname.split('/').pop()
    const incident = (store.incidents || []).find((item) => item.code === code)
    if (!incident) return sendJson(res, 404, { error: 'incident_not_found' })
    return sendJson(res, 200, incident)
  }
  if (req.method === 'POST' && pathname === '/api/admin/secrets') {
    const { name, value } = await readBody(req)
    if (!name || typeof name !== 'string') return sendJson(res, 400, { error: 'secret_name_required' })
    if (!value || typeof value !== 'string') return sendJson(res, 400, { error: 'secret_value_required' })
    const safeName = isLikelyRawSecret(name) ? 'RAZE_PROVIDER_KEY' : sanitizeText(name).replace(/[^A-Z0-9_]/gi, '_').toUpperCase()
    const saved = await saveProviderSecret(safeName, value)
    return sendJson(res, 200, { ok: true, name: safeName, ...saved })
  }
  return sendJson(res, 404, { error: 'admin_route_not_found' })
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname
  const filePath = path.normalize(path.join(distDir, requested))
  if (!filePath.startsWith(distDir)) return sendJson(res, 403, { error: 'forbidden' })
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not file')
    res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream' })
    createReadStream(filePath).pipe(res)
  } catch {
    const indexPath = path.join(distDir, 'index.html')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    createReadStream(indexPath).pipe(res)
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req))
      return res.end()
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    if (pathname === '/health') return sendJson(res, 200, { ok: true, service: 'raze' })
    if (pathname === '/metrics' && req.method === 'GET') {
      if (!metricsEnabled) return sendJson(res, 404, { error: 'metrics_disabled' })
      res.writeHead(200, { ...corsHeaders(req), 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
      return res.end(buildPrometheusMetrics())
    }
    if (pathname === '/api/auth/google' && req.method === 'GET') return startGoogleAuth(req, res)
    if (pathname === '/auth' && req.method === 'GET') return completeGoogleAuth(req, res, url)
    if (pathname === '/api/config' && req.method === 'GET') return sendJson(res, 200, { models: publicModels(await readStore()) })
    if (pathname === '/v1/models' && req.method === 'GET') return sendJson(res, 200, openAiModelList(await readStore()))
    if (pathname === '/api/session' && req.method === 'GET') {
      const store = await readStore()
      const session = authenticateSession(req, store)
      return session ? sendJson(res, 200, { user: publicUser(session.user) }) : sendJson(res, 401, { error: 'session_required' })
    }
    if (pathname === '/api/session' && req.method === 'POST') {
      return sendJson(res, 410, { error: { message: 'Use Google sign-in to create a session.', type: 'google_auth_required' } })
    }
    if (pathname === '/api/profile/avatar' && req.method === 'POST') {
      const store = await readStore()
      const session = authenticateSession(req, store)
      if (!session || session.user.authMethod !== 'google' || !session.user.emailVerified) return sendJson(res, 401, { error: { message: 'Sign in with Google before uploading a profile picture.', type: 'google_session_required' } })
      const body = await readBody(req)
      const avatar = normalizeAvatarUpload(body)
      if (!avatar) return sendJson(res, 400, { error: { message: 'Upload a PNG, JPEG, WEBP, or GIF image under 750 KB.', type: 'invalid_avatar' } })
      const saved = { ...store, users: (store.users || []).map((user) => user.id === session.user.id ? { ...user, avatar, avatarStored: true, avatarUrl: `/api/profile/avatar/${user.id}`, updatedAt: new Date().toISOString() } : user) }
      await writeStore(saved)
      const updated = saved.users.find((user) => user.id === session.user.id)
      return sendJson(res, 200, { user: publicUser(updated) })
    }
    if (pathname.startsWith('/api/profile/avatar/') && req.method === 'GET') {
      const userId = pathname.split('/').pop()
      const store = await readStore()
      const user = (store.users || []).find((item) => item.id === userId)
      if (!user?.avatar?.data || !user?.avatar?.mimeType) return sendJson(res, 404, { error: 'avatar_not_found' })
      const data = Buffer.from(user.avatar.data, 'base64')
      res.writeHead(200, { ...corsHeaders(req), 'content-type': user.avatar.mimeType, 'cache-control': 'private, max-age=300' })
      return res.end(data)
    }
    if (pathname === '/api/keys' && req.method === 'POST') {
      const rate = checkRateLimit(`keygen:${clientIp(req)}`)
      if (!rate.ok) return sendJson(res, 429, { error: { message: 'Too many key generation requests. Try again shortly.', type: 'rate_limited' } })
      const store = await readStore()
      const session = authenticateSession(req, store)
      if (!session || session.user.authMethod !== 'google' || !session.user.emailVerified) return sendJson(res, 401, { error: { message: 'Sign in with Google before generating an API key.', type: 'google_session_required' } })
      const body = await readBody(req)
      const key = createUserKeyForUser(session.user.id, body.label || 'Dashboard key')
      await writeStore({ ...store, userKeys: [persistableUserKey(key), ...(store.userKeys || [])] })
      return sendJson(res, 200, key)
    }
    if ((pathname === '/v1/chat/completions' || pathname === '/chat/completions') && req.method === 'POST') return proxyCompletion(req, res, 'chat')
    if (pathname === '/v1/messages' && req.method === 'POST') return proxyCompletion(req, res, 'messages')
    if (pathname.startsWith('/api/admin/')) return handleAdmin(req, res, pathname)

    return serveStatic(req, res, pathname)
  } catch (error) {
    logEvent('error', 'server_request_failed', { message: error instanceof Error ? error.message : 'unknown_error' })
    return sendJson(res, 500, { error: { message: 'internal_server_error', type: 'server_error' } })
  }
})

function gracefulShutdown(signal) {
  logEvent('info', 'graceful_shutdown_started', { signal })
  server.close(() => {
    if (pgPool) pgPool.end().catch(() => {})
    if (redisClient) redisClient.quit().catch(() => {})
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

server.listen(port, () => {
  logEvent('info', 'server_listening', { port, metricsEnabled, cacheEnabled, hasRedis: Boolean(redisUrl), hasPostgres: Boolean(databaseUrl) })
})

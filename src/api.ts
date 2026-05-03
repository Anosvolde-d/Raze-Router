import type { Model } from './types'

export type UserKeyConfig = { id: string; key?: string; userId?: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number; rpmLimit?: number; rpdLimit?: number }
export type RequestLogEntry = { id: string; at: string; userId: string; keyId?: string; email: string; username: string; model: string; status: number; inputTokens: number; outputTokens: number; totalTokens: number; incidentCode?: string; streamed?: boolean; cacheHit?: boolean; rpdExempt?: boolean }
export type RankingModel = { id: string; name: string; company: string; status: string; tags: string[]; points: number; requests: number; totalTokens: number }
export type RankingCategory = { id: string; label: string; description: string; useRequests?: boolean; models: RankingModel[]; userVote?: { modelId: string; at: string; nextVoteAt: string; locked: boolean } }
export type RankingPayload = { categories: RankingCategory[]; voteCooldownHours: number; generatedAt: string }
export type DashboardStats = { rpdUsed: number; rpdLimit: number; rpmLimit: number; dailyTokens: number; totalTokens: number; requestCount: number; activeKeyId: string | null }
export type UsageCounters = { users?: Record<string, { day: string; rpdUsed: number; dailyTokens: number; totalTokens: number }>; models?: Record<string, { requests: number; totalTokens: number }> }

export type StoreConfig = {
  models: Model[]
  users?: UserProfile[]
  verifiedEmails?: string[]
  keyDefaults?: { rpmLimit?: number; rpdLimit?: number }
  userKeys?: UserKeyConfig[]
  requestLogs?: RequestLogEntry[]
  incidents?: Array<{ code: string; at: string; model?: string; provider?: string; status?: number; upstream?: string | null; userKeyId?: string }>
  rankingEnabled?: boolean
  rankingScores?: Record<string, Record<string, number>>
  rankingBoosts?: Record<string, Record<string, number>>
  usageCounters?: UsageCounters
  audit?: Array<{ at: string; action: string }>
}

export type UserProfile = { id: string; email: string; username: string; avatarUrl?: string; authMethod?: string; emailVerified?: boolean; banned?: boolean; createdAt?: string }

const ADMIN_SESSION_KEY = 'raze.admin.key'
const USER_SESSION_KEY = 'raze.user.session'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = data?.error?.message || data?.error || response.statusText
    throw new Error(String(message).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-secret]'))
  }
  return data as T
}

export function getStoredAdminKey() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) || ''
}

export function setStoredAdminKey(key: string) {
  sessionStorage.setItem(ADMIN_SESSION_KEY, key)
}

export async function fetchPublicConfig() {
  return request<StoreConfig>('/api/config')
}

export async function fetchAdminConfig(adminKey: string) {
  return request<StoreConfig>('/api/admin/config', { headers: { 'x-admin-key': adminKey } })
}

export async function verifyAdminKey(adminKey: string) {
  return request<{ ok: boolean }>('/api/admin/verify', { headers: { 'x-admin-key': adminKey } })
}

export async function saveAdminConfig(adminKey: string, config: StoreConfig) {
  return request<StoreConfig>('/api/admin/config', {
    method: 'PUT',
    headers: { 'x-admin-key': adminKey },
    body: JSON.stringify(config),
  })
}

export async function saveProviderSecret(adminKey: string, name: string, value: string) {
  return request<{ ok: boolean; name: string; persisted: string }>('/api/admin/secrets', {
    method: 'POST',
    headers: { 'x-admin-key': adminKey },
    body: JSON.stringify({ name, value }),
  })
}

export async function fetchRankings() {
  return request<RankingPayload>('/api/rankings', { headers: { 'x-session-token': getUserSessionToken() } })
}

export async function voteRanking(categoryId: string, modelId: string) {
  return request<RankingPayload>('/api/rankings/vote', {
    method: 'POST',
    headers: { 'x-session-token': getUserSessionToken() },
    body: JSON.stringify({ categoryId, modelId }),
  })
}

export async function fetchDashboardStats() {
  return request<DashboardStats>('/api/dashboard/stats', { headers: { 'x-session-token': getUserSessionToken() } })
}

export async function adminBoostRanking(adminKey: string, categoryId: string, modelId: string, amount: number) {
  return request<StoreConfig>('/api/admin/rankings/boost', {
    method: 'POST',
    headers: { 'x-admin-key': adminKey },
    body: JSON.stringify({ categoryId, modelId, amount }),
  })
}

function streamContentFromPayload(payload: unknown) {
  const typed = payload as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; text?: string }> }
  if (!Array.isArray(typed.choices)) return ''
  return typed.choices.map((choice) => {
    const content = choice.delta?.content ?? choice.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : String((part as { text?: string })?.text || '')).join('')
    return choice.text || ''
  }).join('')
}

export async function sendChatCompletionStream(body: unknown, onDelta: (delta: string) => void) {
  const apiKey = localStorage.getItem('raze.user.apiKey') || ''
  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    let message = response.statusText
    try {
      const data = text ? JSON.parse(text) : null
      message = data?.error?.message || data?.error || response.statusText
    } catch {
      message = text || response.statusText
    }
    throw new Error(String(message).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-secret]'))
  }

  if (!response.body) throw new Error('Streaming response body is unavailable.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  const consumeEvent = (rawEvent: string) => {
    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      const delta = streamContentFromPayload(JSON.parse(data))
      if (!delta) continue
      fullText += delta
      onDelta(delta)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    while (buffer.includes('\n\n')) {
      const splitAt = buffer.indexOf('\n\n')
      const rawEvent = buffer.slice(0, splitAt)
      buffer = buffer.slice(splitAt + 2)
      consumeEvent(rawEvent)
    }
  }

  buffer += decoder.decode().replace(/\r\n/g, '\n')
  if (buffer.trim()) consumeEvent(buffer)
  return { text: fullText }
}

export async function createUserApiKey(label = 'Dashboard key') {
  return request<UserKeyConfig & { key: string }>('/api/keys', {
    method: 'POST',
    headers: { 'x-session-token': getUserSessionToken() },
    body: JSON.stringify({ label }),
  })
}

export async function createAdminUserApiKey(adminKey: string, label = 'Admin-created key') {
  return request<UserKeyConfig & { key: string }>('/api/admin/keys', {
    method: 'POST',
    headers: { 'x-admin-key': adminKey },
    body: JSON.stringify({ label }),
  })
}

export async function deleteAdminUser(adminKey: string, userId: string) {
  return request<StoreConfig>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': adminKey },
  })
}

export async function deleteAllAdminUsers(adminKey: string) {
  return request<StoreConfig>('/api/admin/users', {
    method: 'DELETE',
    headers: { 'x-admin-key': adminKey },
  })
}

export async function deleteAdminUserKey(adminKey: string, keyId: string) {
  return request<StoreConfig>(`/api/admin/keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': adminKey },
  })
}

export async function deleteAllAdminUserKeys(adminKey: string) {
  return request<StoreConfig>('/api/admin/keys', {
    method: 'DELETE',
    headers: { 'x-admin-key': adminKey },
  })
}

export function storeUserApiKey(key: string) {
  localStorage.setItem('raze.user.apiKey', key)
}

export function clearUserApiKey() {
  localStorage.removeItem('raze.user.apiKey')
}

export function getUserApiKey() {
  return localStorage.getItem('raze.user.apiKey') || ''
}

export function getUserSessionToken() {
  return localStorage.getItem(USER_SESSION_KEY) || ''
}

export function storeUserSession(token: string) {
  localStorage.setItem(USER_SESSION_KEY, token)
}

export function clearUserSession() {
  localStorage.removeItem(USER_SESSION_KEY)
  localStorage.removeItem('raze.user.apiKey')
}

export function startGoogleAuth() {
  window.location.href = '/api/auth/google'
}

export async function fetchUserSession() {
  return request<{ user: UserProfile }>('/api/session', { headers: { 'x-session-token': getUserSessionToken() } })
}

export async function uploadAvatar(dataUrl: string): Promise<{ user: UserProfile }> {
  const response = await fetch('/api/profile/avatar', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-session-token': getUserSessionToken(),
    },
    body: JSON.stringify({ dataUrl }),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = data?.error?.message || data?.error || response.statusText
    throw new Error(String(message))
  }
  return data as { user: UserProfile }
}

export async function fetchAdminIncident(adminKey: string, code: string) {
  return request<{ code: string; at: string; model?: string; provider?: string; status?: number; upstream?: string; userKeyId?: string }>(
    `/api/admin/incidents/${encodeURIComponent(code)}`,
    { headers: { 'x-admin-key': adminKey } }
  )
}

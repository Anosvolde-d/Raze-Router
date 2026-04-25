import type { Model } from './types'

export type StoreConfig = {
  models: Model[]
  users?: UserProfile[]
  userKeys?: Array<{ id: string; key?: string; userId?: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number }>
  requestLogs?: Array<{ id: string; at: string; userId: string; email: string; username: string; model: string; status: number; inputTokens: number; outputTokens: number; totalTokens: number; incidentCode?: string }>
  incidents?: Array<{ code: string; at: string; model?: string; provider?: string; status?: number }>
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

export async function sendChatCompletion(body: unknown) {
  const apiKey = localStorage.getItem('raze.user.apiKey') || ''
  return request<unknown>('/v1/chat/completions', {
    method: 'POST',
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    body: JSON.stringify(body),
  })
}

export async function createUserApiKey(label = 'Dashboard key') {
  return request<{ id: string; key: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number }>('/api/keys', {
    method: 'POST',
    headers: { 'x-session-token': getUserSessionToken() },
    body: JSON.stringify({ label }),
  })
}

export async function createAdminUserApiKey(adminKey: string, label = 'Admin-created key') {
  return request<{ id: string; key: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number }>('/api/admin/keys', {
    method: 'POST',
    headers: { 'x-admin-key': adminKey },
    body: JSON.stringify({ label }),
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

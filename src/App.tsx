import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, Check, ChevronRight, ChevronUp, Code, Heart, Pen, Smile, Trophy, Zap, type LucideIcon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { CacheMode, Capability, Model, ModelStatus, ProviderType, Visibility } from './types'
import { capabilityDescriptions, createBlankModel, seedModels } from './data/models'
import { changelog } from './data/changelog'
import { adminBoostRanking, clearUserApiKey, clearUserSession, createUserApiKey, deleteAdminUser, deleteAdminUserKey, deleteAllAdminUserKeys, deleteAllAdminUsers, fetchAdminConfig, fetchAdminIncident, fetchDashboardStats, fetchPublicConfig, fetchRankings, fetchUserSession, getStoredAdminKey, getUserApiKey, saveAdminConfig, saveProviderSecret, sendChatCompletionStream, setStoredAdminKey, startGoogleAuth, storeUserApiKey, uploadAvatar, verifyAdminKey, voteRanking, type DashboardStats, type RankingCategory, type RankingGroup, type RankingPayload, type RequestLogEntry, type StoreConfig, type UserKeyConfig, type UserProfile } from './api'

const views = ['Landing', 'Models', 'Ranking', 'Playground', 'Dashboard', 'Changelog'] as const
type View = (typeof views)[number] | 'Admin'

type AdminConfig = Partial<StoreConfig>

type IncidentDetail = { code: string; at: string; model?: string; provider?: string; status?: number; upstream?: string | null; userKeyId?: string }
type PlaygroundContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'file'; file: { name: string; mimeType: string; dataUrl: string } }
type PlaygroundMessage = { role: 'user' | 'assistant'; content: string | PlaygroundContentPart[]; attachments?: PlaygroundAttachment[] }
type PlaygroundAttachment = { id: string; name: string; type: string; dataUrl: string; kind: 'image' | 'file' }
type RenderSegment = { type: 'thinking' | 'markdown'; content: string; closed?: boolean }
type ConfirmState = { open: boolean; title: string; body: string; confirmLabel?: string; tone?: 'default' | 'danger'; onConfirm: () => void }

type AdminSection = 'Routes' | 'Aliases' | 'Accounts' | 'Verification' | 'Unlimited' | 'Ranking' | 'Request Logs'

const filters = ['All', 'Online', 'Vision', 'Multimodal', 'Fast', 'Long Context', 'Experimental', 'New', 'Staff Picks']
const sortOptions = ['Priority', 'Fastest', 'Longest Context', 'Recently Added', 'Alphabetical']
const adminSections: AdminSection[] = ['Routes', 'Aliases', 'Accounts', 'Verification', 'Unlimited', 'Ranking', 'Request Logs']
const rankingVoteCategories = [
  { id: 'coding', label: 'Coding' },
  { id: 'creative-writing', label: 'Creative Writing' },
  { id: 'humor-personality', label: 'Humor & Personality' },
]
const rankingCategoryIcons: Record<string, LucideIcon> = { coding: Code, 'creative-writing': Pen, 'humor-personality': Smile, 'most-used': BarChart3 }
const capabilities: Capability[] = ['Vision', 'Audio', 'Video', 'Files', 'Tools', 'Reasoning', 'Streaming', 'Multimodal']
const providerTypes: ProviderType[] = ['OpenAI Compatible', 'Anthropic', 'Custom']
const cacheModes: CacheMode[] = ['Off', 'Anthropic Prompt Cache', 'OpenAI Compatible Cache', 'Hybrid']
const statuses: ModelStatus[] = ['Online', 'Offline', 'Coming Soon', 'Degraded']
const visibilities: Visibility[] = ['Public', 'Hidden', 'Staff Only', 'Preview']
const tagOptions = filters.filter((item) => item !== 'All' && item !== 'Online')
const descriptionColors = ['Default', 'Mint', 'Purple', 'Amber', 'Rose'] as const
type DescriptionColor = (typeof descriptionColors)[number]
const capabilityIcons: Record<Capability, string> = { Vision: 'visibility', Audio: 'graphic_eq', Video: 'movie', Files: 'draft', Tools: 'construction', Reasoning: 'psychology', Streaming: 'stream', Multimodal: 'hub' }
const PLAYGROUND_MAX_ATTACH_BYTES = 4 * 1024 * 1024
const PLAYGROUND_MAX_LINES = 5

function normalizeMediaUrl(url?: string) {
  const value = url?.trim()
  if (!value) return ''

  try {
    const parsed = new URL(value)
    if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
      return `https://raw.githubusercontent.com${parsed.pathname.replace('/blob/', '/')}`
    }
  } catch {
    return value
  }

  return value
}

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function looksLikeRawSecret(value: string) {
  return /^(sk-|sk_|eyJ|AIza|xox[baprs]-)/.test(value) || (value.length > 40 && !/^[A-Z0-9_]+$/.test(value))
}

function safeSecretName(model: Model) {
  return `RAZE_${model.id.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase()}_KEY`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatCompactNumber(value?: number | null) {
  const normalized = Number(value || 0)
  if (!Number.isFinite(normalized)) return '0'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: normalized >= 1000 ? 1 : 0 }).format(normalized)
}

function formatRankingCooldown(value?: string) {
  if (!value) return ''
  const remainingMs = new Date(value).getTime() - Date.now()
  if (!Number.isNaN(remainingMs) && remainingMs > 0) {
    const hours = Math.floor(remainingMs / 3_600_000)
    const minutes = Math.max(1, Math.ceil((remainingMs % 3_600_000) / 60_000))
    return hours ? hours + 'h ' + minutes + 'm' : minutes + 'm'
  }
  return 'ready'
}

function rankingGroupId(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return slug || `group-${Date.now().toString(36)}`
}

function initials(value: string) {
  return value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AI'
}

function rankTone(rank: number) {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'neutral'
}
function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function fingerprint(value?: string) {
  if (!value) return 'hidden'
  return value.length <= 10 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`
}

function maskApiKey(value: string) {
  if (!value) return '*'.repeat(24)
  return '*'.repeat(Math.max(24, Math.min(value.length, 42)))
}

function normalizeAliasInput(value: string) {
  return splitList(value).map((alias) => alias.replace(/\s+/g, ' ').trim())
}

function descriptionColorFromTags(tags: string[]): DescriptionColor {
  const marker = tags.find((tag) => tag.startsWith('Color:'))
  const color = marker?.replace('Color:', '').trim()
  return descriptionColors.includes(color as DescriptionColor) ? color as DescriptionColor : 'Default'
}

function updateDescriptionColorTags(tags: string[], color: DescriptionColor) {
  const visibleTags = tags.filter((tag) => !tag.startsWith('Color:'))
  return color === 'Default' ? visibleTags : [...visibleTags, `Color:${color}`]
}

function modelTagOptions(models: Model[]) {
  const configured = models.flatMap((model) => model.tags || []).filter((tag) => tag && !tag.startsWith('Color:'))
  return [...new Set([...tagOptions, ...configured])].sort((a, b) => a.localeCompare(b))
}

function normalizeCodeFences(value: string) {
  const lines = value.split('\n')
  const normalized: string[] = []
  let inFence = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^```/.test(trimmed)) {
      inFence = !inFence
      normalized.push(line)
      continue
    }

    if (!inFence && /^\s*</.test(line) && /<\/?[a-z][\s\S]*>/i.test(trimmed)) {
      normalized.push('```html')
      normalized.push(line)
      normalized.push('```')
      continue
    }

    normalized.push(line)
  }

  return normalized.join('\n')
}

function parseThinkingSegments(value: string): RenderSegment[] {
  const source = normalizeCodeFences(value)
  const segments: RenderSegment[] = []
  const openTag = /<(think|thinking)>/gi
  const closeTag = /<\/(think|thinking)>/gi
  let cursor = 0
  let openMatch: RegExpExecArray | null

  while ((openMatch = openTag.exec(source)) !== null) {
    const plain = source.slice(cursor, openMatch.index)
    if (plain.trim()) segments.push({ type: 'markdown', content: plain })

    closeTag.lastIndex = openTag.lastIndex
    const closeMatch = closeTag.exec(source)
    if (closeMatch) {
      const thinkingContent = source.slice(openTag.lastIndex, closeMatch.index)
      segments.push({ type: 'thinking', content: thinkingContent, closed: true })
      cursor = closeTag.lastIndex
      openTag.lastIndex = cursor
    } else {
      const thinkingContent = source.slice(openTag.lastIndex)
      segments.push({ type: 'thinking', content: thinkingContent, closed: false })
      cursor = source.length
      break
    }
  }

  const trailing = source.slice(cursor)
  if (trailing.trim()) segments.push({ type: 'markdown', content: trailing })
  return segments.length ? segments : [{ type: 'markdown', content: source }]
}

function detectFenceLanguage(className?: string) {
  const match = /language-([\w-]+)/.exec(className || '')
  return match?.[1] || 'code'
}

function resizeComposer(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  textarea.style.height = '0px'
  const computed = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(computed.lineHeight || '22') || 22
  const maxHeight = lineHeight * PLAYGROUND_MAX_LINES + 12
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
}

function App() {
  const [view, setView] = useState<View>('Landing')
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('Priority')
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminKey, setAdminKey] = useState(getStoredAdminKey())
  const [password, setPassword] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const [adminGateOpen, setAdminGateOpen] = useState(false)
  const [syncState, setSyncState] = useState('checking backend...')
  const [models, setModels] = useState<Model[]>(seedModels)
  const [rankingEnabled, setRankingEnabled] = useState(false)
  const [focusedCard, setFocusedCard] = useState<string | null>(null)
  const [userApiKey, setUserApiKey] = useState('')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({})
  const [copied, setCopied] = useState('')
  const [adminSection, setAdminSection] = useState<AdminSection>('Routes')
  const [selectedModelId, setSelectedModelId] = useState(seedModels[0].id)
  const [playgroundError, setPlaygroundError] = useState('')
  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false, title: '', body: '', confirmLabel: 'Confirm', tone: 'default', onConfirm: () => {} })
  const [authNotice, setAuthNotice] = useState<{ title: string; body: string } | null>(null)

  const closeConfirm = useCallback(() => {
    setConfirmState((prev) => ({ ...prev, open: false }))
  }, [])

  const closeAuthNotice = useCallback(() => {
    setAuthNotice(null)
  }, [])

  const openConfirm = useCallback((title: string, body: string, onConfirm: () => void, confirmLabel = 'Confirm', tone: 'default' | 'danger' = 'default') => {
    setConfirmState({ open: true, title, body, onConfirm, confirmLabel, tone })
  }, [])

  useEffect(() => {
    fetchUserSession().then((session) => {
      setUser(session.user)
      setUserApiKey(getUserApiKey())
    }).catch(() => {
      clearUserApiKey()
      setUserApiKey('')
      setUser(null)
    })
  }, [])

  useEffect(() => {
    fetchPublicConfig().then((config) => {
      if (config.models?.length) setModels(config.models)
      setRankingEnabled(config.rankingEnabled === true)
      setSyncState('backend connected')
    }).catch((error) => setSyncState(`local fallback: ${error.message}`))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authStatus = params.get('auth')
    if (authStatus === 'email_unverified' || authStatus === 'email_not_verified_by_admin') {
      setAuthNotice({ title: 'Email not verified', body: "Gne gne, your email isn't verified. Please contact an admin." })
    }
    if (authStatus) {
      params.delete('auth')
      const nextSearch = params.toString()
      window.history.replaceState({}, document.title, `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`)
    }
  }, [])

  useEffect(() => {
    if (!rankingEnabled && view === 'Ranking') setView('Models')
  }, [rankingEnabled, view])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'm') {
        event.preventDefault()
        if (adminUnlocked) {
          setView('Admin')
        } else {
          setAdminGateOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [adminUnlocked])

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0]
  const featuredModels = models.filter((model) => model.featured && model.visibility !== 'Hidden')

  const visibleModels = useMemo(() => {
    const filtered = models.filter((model) => {
      if (model.visibility === 'Hidden') return false
      if (filter === 'All') return true
      if (filter === 'Online') return model.status === 'Online'
      return model.tags.includes(filter) || model.groups.includes(filter) || model.capabilities.includes(filter as Capability)
    })

    return [...filtered].sort((a, b) => {
      if (sort === 'Fastest') return (a.firstToken ?? 99) - (b.firstToken ?? 99)
      if (sort === 'Longest Context') return b.maxContext - a.maxContext
      if (sort === 'Recently Added') return b.added.localeCompare(a.added)
      if (sort === 'Alphabetical') return a.name.localeCompare(b.name)
      return a.sortPriority - b.sortPriority
    })
  }, [filter, models, sort])

  const copyId = async (id: string) => {
    await navigator.clipboard?.writeText(id)
    setCopied(id)
    window.setTimeout(() => setCopied(''), 1200)
  }

  const updateModel = (patch: Partial<Model>) => {
    const previousId = selectedModel.id
    setModels((current) => current.map((model) => (model.id === previousId ? { ...model, ...patch } : model)))
    if (patch.id && patch.id !== previousId) setSelectedModelId(patch.id)
  }

  const saveConfig = async () => {
    if (!adminKey) return setSyncState('admin key required')
    try {
      const saved = await saveAdminConfig(adminKey, { ...adminConfig, models })
      setModels(saved.models)
      setAdminConfig(saved)
      setRankingEnabled(saved.rankingEnabled === true)
      setSyncState('config saved')
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : 'save failed')
    }
  }

  const refreshAdmin = async () => {
    if (!adminKey) return
    const config = await fetchAdminConfig(adminKey)
    setModels(config.models)
    setAdminConfig(config)
    setRankingEnabled(config.rankingEnabled === true)
  }

  const updateAdminConfig = useCallback((updater: (config: AdminConfig) => AdminConfig) => {
    setAdminConfig((current) => updater(current))
  }, [])

  const saveSecret = async (name: string, value: string) => {
    if (!adminKey) return setSyncState('admin key required')
    const secretName = looksLikeRawSecret(name) ? safeSecretName(selectedModel) : name
    try {
      if (secretName !== name) updateModel({ providerConfig: { ...selectedModel.providerConfig, apiKeyLabel: secretName } })
      const saved = await saveProviderSecret(adminKey, secretName, value)
      setSyncState(`secret ${saved.name} saved to ${saved.persisted}`)
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : 'secret save failed')
    }
  }

  const addModel = () => {
    const next = createBlankModel(models.length + 1)
    setModels((current) => [...current, next])
    setSelectedModelId(next.id)
    setAdminSection('Routes')
  }

  const deleteModel = () => {
    if (models.length <= 1) return
    openConfirm('Delete route', `Delete "${selectedModel.name || selectedModel.id}"? This cannot be undone.`, () => {
      const remaining = models.filter((model) => model.id !== selectedModelId)
      setModels(remaining)
      setSelectedModelId(remaining[0].id)
    }, 'Delete route', 'danger')
  }

  const unlockAdmin = async () => {
    try {
      await verifyAdminKey(password)
      setStoredAdminKey(password)
      setAdminKey(password)
      setAdminUnlocked(true)
      setAdminGateOpen(false)
      setPassword('')
      setView('Admin')
      fetchAdminConfig(password).then((config) => {
        if (config.models?.length) setModels(config.models)
        setAdminConfig(config)
        setRankingEnabled(config.rankingEnabled === true)
        setSyncState('admin backend connected')
      }).catch((error) => setSyncState(error instanceof Error ? error.message : 'admin sync failed'))
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : 'admin unlock failed')
    }
  }

  const logout = () => {
    clearUserSession()
    setUserApiKey('')
    setUser(null)
    setView('Landing')
  }

  const authMode = user?.authMethod === 'google' && user.emailVerified ? 'GOOGLE VERIFIED' : 'SIGN-IN REQUIRED'
  const visibleViews = useMemo<View[]>(() => rankingEnabled ? [...views] : views.filter((item) => item !== 'Ranking'), [rankingEnabled])

  return (
    <>
      <nav className="top-nav">
        <button className="wordmark ghost-button" onClick={() => setView('Landing')}>RAZE</button>
        <div className="nav-links">
          {visibleViews.map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item}</button>)}
        </div>
        <div className="top-nav-actions">
          <button className="profile-chip" onClick={() => setView('Dashboard')}>{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{user?.username?.slice(0, 1) || '?'}</span>}</button>
          <button className="launch-btn" onClick={() => setLoginOpen(true)}><span /> {user ? 'Account' : 'Launch'}</button>
        </div>
      </nav>

      <main className="app-frame">
        {view === 'Landing' && <Landing setView={setView} openLogin={() => setLoginOpen(true)} models={featuredModels.length ? featuredModels : visibleModels.slice(0, 3)} focusedCard={focusedCard} setFocusedCard={setFocusedCard} copyId={copyId} copied={copied} stats={{ modelCount: visibleModels.length, authMode, adminUnlocked, cacheModes: cacheModes.length, providerCount: providerTypes.length, access: 'COMMUNITY' }} />}
        {view === 'Models' && <ModelsView filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} visibleModels={visibleModels} copyId={copyId} copied={copied} />}
        {view === 'Ranking' && rankingEnabled && <ModelRanking user={user} openLogin={() => setLoginOpen(true)} />}
        {view === 'Playground' && <Playground models={visibleModels} userApiKey={userApiKey} error={playgroundError} setError={setPlaygroundError} />}
        {view === 'Dashboard' && <Dashboard setView={setView} openLogin={() => setLoginOpen(true)} userApiKey={userApiKey} setUserApiKey={setUserApiKey} user={user} setUser={setUser} logout={logout} openConfirm={openConfirm} rankingEnabled={rankingEnabled} />}
        {view === 'Admin' && adminUnlocked && selectedModel && <AdminPanel models={models} adminConfig={adminConfig} updateAdminConfig={updateAdminConfig} selectedModel={selectedModel} selectedModelId={selectedModelId} setSelectedModelId={setSelectedModelId} adminSection={adminSection} setAdminSection={setAdminSection} updateModel={updateModel} addModel={addModel} deleteModel={deleteModel} saveConfig={saveConfig} saveSecret={saveSecret} syncState={syncState} toggleCapability={(cap) => toggleCapability(selectedModel, updateModel, cap)} refreshAdmin={refreshAdmin} adminKey={adminKey} openConfirm={openConfirm} />}
        {view === 'Admin' && adminUnlocked && !selectedModel && <div style={{ padding: '60px 5vw' }}><p style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.9rem' }}>Loading routes from backend...</p></div>}
        {view === 'Admin' && !adminUnlocked && <LockedAdmin openGate={() => setAdminGateOpen(true)} />}
        {view === 'Changelog' && <Changelog />}
      </main>

      {loginOpen && <LoginModal close={() => setLoginOpen(false)} user={user} />}
      {adminGateOpen && <AdminGate password={password} setPassword={setPassword} close={() => setAdminGateOpen(false)} submit={unlockAdmin} />}
      {authNotice && <NoticeModal title={authNotice.title} body={authNotice.body} close={closeAuthNotice} />}
      {confirmState.open && <ConfirmModal title={confirmState.title} body={confirmState.body} confirmLabel={confirmState.confirmLabel} tone={confirmState.tone} close={closeConfirm} confirm={() => { confirmState.onConfirm(); closeConfirm() }} />}
    </>
  )
}

function Landing({ setView, openLogin, models, focusedCard, setFocusedCard, copyId, copied, stats }: { setView: (view: View) => void; openLogin: () => void; models: Model[]; focusedCard: string | null; setFocusedCard: (id: string | null) => void; copyId: (id: string) => void; copied: string; stats: { modelCount: number; authMode: string; adminUnlocked: boolean; cacheModes: number; providerCount: number; access: string } }) {
  return <section className="hero view-shell"><div className="hero-copy"><p className="eyebrow">secure ai router / admin-configured / community access</p><h1>Raze router, built by me and my bestfriend claude &#128077;</h1><p className="hero-lede">RAZE is a production-ready AI router for model discovery, provider routing, exact-match caching, Google-authenticated access, and real-time streaming through a single OpenAI-style interface.</p><div className="hero-actions"><button className="primary" onClick={openLogin}>{'Sign in with Google'}</button><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button><button className="secondary" onClick={() => setView('Models')}>Explore Models</button></div></div><TerminalHero /><StatsBar stats={stats} /><section className="showcase-panel"><div><p className="eyebrow">model.cards</p><h2>Configured by admins, rendered live.</h2><p>Cards use admin-defined metadata and stay aligned with the public registry without exposing provider secrets or internal endpoints.</p></div><div className="showcase-grid">{models.length ? models.map((model) => <ModelCard key={model.id} model={model} mode="showcase" focused={focusedCard === model.id} dimmed={Boolean(focusedCard && focusedCard !== model.id)} onFocus={setFocusedCard} onCopy={copyId} copied={copied === model.id} />) : <EmptyState title="No featured routes" body="Feature a model in Admin to show it here." />}</div></section></section>
}

function TerminalHero() {
  return <div className="terminal-card"><div className="terminal-top"><span>RAZE://BOOT</span><i /></div><div className="kinetic-word" aria-label="RAZE"><span>R</span><span>A</span><span>Z</span><span>E</span></div><div className="boot-lines">{['loading registry', 'checking configured providers', 'warming cache policy', 'preparing protected router'].map((line, index) => <p key={line} style={{ animationDelay: `${index * 180}ms` }}>&gt; {line}</p>)}<p className="operational">&gt; router operational <b>_</b></p></div></div>
}

function StatsBar({ stats }: { stats: { modelCount: number; authMode: string; adminUnlocked: boolean; cacheModes: number; providerCount: number; access: string } }) {
  const values = [['MODELS', String(stats.modelCount)], ['AUTH', stats.authMode], ['ADMIN', stats.adminUnlocked ? 'UNLOCKED' : 'LOCKED'], ['CACHE MODES', String(stats.cacheModes)], ['PROVIDERS', String(stats.providerCount)], ['ACCESS', stats.access]]
  return <section className="stats-bar">{values.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</section>
}

function ModelsView({ filter, setFilter, sort, setSort, visibleModels, copyId, copied }: { filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; visibleModels: Model[]; copyId: (id: string) => void; copied: string }) {
  return <section className="view-shell registry-section"><div className="section-heading split-heading"><div><p className="eyebrow">registry</p><h2>Model Registry</h2><p>Only configured, visible routes appear here. Add production routes from the protected admin panel.</p></div><div className="registry-readout">visible / {visibleModels.length}</div></div><div className="toolbar"><div className="chip-row">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'chip active' : 'chip'}>{item}</button>)}</div><select value={sort} onChange={(event) => setSort(event.target.value)}>{sortOptions.map((item) => <option key={item}>{item}</option>)}</select></div><div className="model-grid">{visibleModels.length ? visibleModels.map((model) => <ModelCard key={model.id} model={model} onCopy={copyId} copied={copied === model.id} />) : <EmptyState title="No visible routes" body="No visible routes are published yet." />}</div></section>
}

function ModelRanking({ user, openLogin }: { user: UserProfile | null; openLogin: () => void }) {
  const [payload, setPayload] = useState<RankingPayload | null>(null)
  const [activeCategoryId, setActiveCategoryId] = useState('')
  const [rankingState, setRankingState] = useState('loading model ranking...')
  const [votingModelId, setVotingModelId] = useState('')

  const loadRankings = useCallback(async () => {
    try {
      const rankings = await fetchRankings()
      setPayload(rankings)
      setActiveCategoryId((current) => current || rankings.categories[0]?.id || '')
      setRankingState('live ranking synced')
    } catch (error) {
      setRankingState(error instanceof Error ? error.message : 'ranking unavailable')
    }
  }, [])

  useEffect(() => {
    void loadRankings()
  }, [loadRankings, user?.id])

  const activeCategory = payload?.categories.find((category) => category.id === activeCategoryId) || payload?.categories[0]
  const sortedModels = useMemo(() => {
    if (!activeCategory) return []
    return [...activeCategory.models].sort((a, b) => {
      const left = activeCategory.useRequests ? b.requests - a.requests : b.points - a.points
      return left || a.name.localeCompare(b.name)
    })
  }, [activeCategory])
  const maxValue = Math.max(1, ...sortedModels.map((model) => activeCategory?.useRequests ? model.requests : model.points))
  const userVote = activeCategory?.userVote
  const locked = Boolean(userVote?.locked && userVote.nextVoteAt && new Date(userVote.nextVoteAt).getTime() > Date.now())

  const castVote = async (category: RankingCategory, modelId: string) => {
    if (!user) {
      openLogin()
      return
    }
    if (category.useRequests || locked) return
    setVotingModelId(modelId)
    try {
      const next = await voteRanking(category.id, modelId)
      setPayload(next)
      setRankingState('vote saved - next vote unlocks in 12h')
    } catch (error) {
      setRankingState(error instanceof Error ? error.message : 'vote failed')
    } finally {
      setVotingModelId('')
    }
  }

  return <section className="view-shell ranking-section"><div className="ranking-shell"><header className="ranking-hero"><motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35 }} className="ranking-hero-copy"><span className="ranking-hero-icon"><Trophy size={22} /></span><p className="eyebrow">model.ranking</p><h2>Model Ranking</h2><p>Community tier lists for every public route. Coding, writing, and personality use votes; Most Used Models stays linked to real routed request counts.</p></motion.div><motion.div className="ranking-cooldown-card" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .35, delay: .08 }}><div className="ranking-cooldown-top"><span><Zap size={16} /> vote cooldown</span><b>{payload ? payload.voteCooldownHours + 'h' : '12h'}</b></div><p>{rankingState}</p><small>{activeCategory?.useRequests ? 'request leaderboard updates automatically' : locked ? 'next vote in ' + formatRankingCooldown(userVote?.nextVoteAt) : 'ready for your next category vote'}</small></motion.div></header><nav className="ranking-tabs" aria-label="Model ranking categories">{payload?.categories.length ? payload.categories.map((category) => { const Icon = rankingCategoryIcons[category.id] || Trophy; return <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .98 }} key={category.id} type="button" className={activeCategory?.id === category.id ? 'active' : ''} onClick={() => setActiveCategoryId(category.id)}><span><Icon size={17} />{category.label}</span><small>{category.useRequests ? 'requests' : 'votes'}</small></motion.button> }) : rankingVoteCategories.map((category) => { const Icon = rankingCategoryIcons[category.id] || Trophy; return <button key={category.id} type="button" disabled><span><Icon size={17} />{category.label}</span><small>loading</small></button> })}</nav><AnimatePresence mode="wait">{activeCategory ? <motion.div key={activeCategory.id} className="ranking-board" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: .25 }}><div className="ranking-board-head"><div><p className="eyebrow">{activeCategory.useRequests ? 'request leaderboard' : 'community vote'}</p><h3>{activeCategory.label}</h3><p>{activeCategory.description}</p></div>{activeCategory.useRequests ? <span><BarChart3 size={15} /> ranked by req</span> : <span>{locked ? <><ChevronRight size={15} /> next vote {formatRankingCooldown(userVote?.nextVoteAt)}</> : <><Check size={15} /> vote ready</>}</span>}</div><div className="ranking-card-list">{sortedModels.length ? sortedModels.map((model, index) => {
    const rank = index + 1
    const value = activeCategory.useRequests ? model.requests : model.points
    const width = Math.max(value > 0 ? 7 : 0, Math.round((value / maxValue) * 100))
    const votedForThis = userVote?.modelId === model.id
    const voteLabel = !user ? 'Sign in' : locked ? (votedForThis ? 'Voted' : 'Cooldown') : votedForThis ? 'Vote again' : 'Vote'
    return <motion.article className="ranking-card" key={activeCategory.id + '-' + model.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .04 }}><div className={'ranking-rank ' + rankTone(rank)}><Trophy size={16} /><span>#{rank}</span></div><div className="ranking-avatar" title={model.groupName || model.name}>{model.groupLogoUrl ? <img src={model.groupLogoUrl} alt={(model.groupName || model.name) + ' logo'} /> : <span>{initials(model.groupName || model.name)}</span>}</div><div className="ranking-model-main"><div className="ranking-model-title"><div><h4>{model.name}</h4><p>{model.groupName ? model.groupName + ' group / ' : ''}{model.company} / <code>{model.id}</code></p></div><span>{model.status}</span></div><div className="ranking-progress"><motion.span initial={{ width: 0 }} animate={{ width: width + '%' }} transition={{ duration: .6, delay: index * .05 }} /></div><div className="ranking-model-tags">{model.tags.slice(0, 4).map((tag) => <em key={tag}>{tag}</em>)}</div></div><div className="ranking-score"><b>{formatCompactNumber(value)}</b><span>{activeCategory.useRequests ? 'req' : 'pts'}</span><small>{formatCompactNumber(model.totalTokens)} tokens</small>{!activeCategory.useRequests && <button type="button" className={'ranking-vote-btn ' + (votedForThis ? 'active' : '')} disabled={Boolean(votingModelId) || locked} onClick={() => castVote(activeCategory, model.id)}>{votingModelId === model.id ? 'Saving...' : votedForThis ? <><Check size={15} />{voteLabel}</> : <><Heart size={15} />{voteLabel}</>}</button>}</div><ChevronUp className="ranking-card-chevron" size={18} /></motion.article>
  }) : <EmptyState title="No ranking models" body="Publish public models in Admin to fill this leaderboard." />}</div></motion.div> : <motion.div key="ranking-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><EmptyState title="Ranking unavailable" body="The ranking endpoint did not return any categories yet." /></motion.div>}</AnimatePresence></div></section>
}

function VideoBackground({ url, title }: { url?: string; title: string }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const src = normalizeMediaUrl(url)

  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [src])

  useEffect(() => {
    const node = wrapperRef.current
    if (!node) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '360px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [src])

  return <div ref={wrapperRef} className={'video-bg-wrap ' + (loaded ? 'loaded' : '')}>{(!src || failed) ? <div className="video-fallback"><span>{failed ? 'video failed to load' : 'no video url'}</span></div> : visible ? <video key={src} src={src} title={title + ' background video'} autoPlay muted loop playsInline preload="metadata" onLoadedData={() => setLoaded(true)} onCanPlay={() => setLoaded(true)} onError={() => setFailed(true)} onStalled={() => setFailed(true)} /> : <div className="video-fallback video-loading"><span>video queued</span></div>}</div>
}

function ModelDescription({ model }: { model: Model }) {
  const color = descriptionColorFromTags(model.tags)
  return <div className={'model-description-glass color-' + color.toLowerCase()}><ReactMarkdown components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, p: ({ children }) => <p>{children}</p>, code: ({ children }) => <code>{children}</code> }}>{model.description || '_No description configured._'}</ReactMarkdown></div>
}

function ModelCard({ model, mode, focused, dimmed, onFocus, onCopy, copied }: { model: Model; mode?: 'showcase'; focused?: boolean; dimmed?: boolean; onFocus?: (id: string | null) => void; onCopy: (id: string) => void; copied: boolean }) {
  return <article className={'model-card ' + (mode === 'showcase' ? 'portrait ' : '') + (dimmed ? 'dimmed ' : '') + (focused ? 'focused' : '')} onMouseEnter={() => onFocus?.(model.id)} onMouseLeave={() => onFocus?.(null)} style={{ '--card-gradient': model.gradient } as CSSProperties}><VideoBackground url={model.videoUrl} title={model.name} /><div className="card-shade" /><div className="model-card-content"><StatusPill status={model.status} /><div className="model-main"><h3>{model.name}</h3><button className="copy-id" onClick={() => onCopy(model.id)}>{copied ? 'copied' : model.id}</button><ModelDescription model={model} /></div><div className="model-meta"><span>{Math.round(model.maxContext / 1000)}K ctx</span><span>{model.providerConfig.provider}</span><span>{model.providerConfig.cacheMode}</span>{model.rpdExempt ? <span>unlimited RPD</span> : null}</div><div className="cap-icons">{model.capabilities.map((cap) => <CapabilityIcon key={cap} capability={cap} />)}</div></div></article>
}

function StatusPill({ status }: { status: ModelStatus }) {
  return <span className={`status status-${status.toLowerCase().replace(/ /g, '-')}`}>{status}</span>
}

function CapabilityIcon({ capability }: { capability: Capability }) {
  return <span className="cap-icon material-symbols-rounded" aria-label={capability}>{capabilityIcons[capability]}<em>{capability}: {capabilityDescriptions[capability]}</em></span>
}

function CodeBlockShell({ className, children }: { className?: string; children?: ReactNode }) {
  const value = String(children || '').replace(/\n$/, '')
  return <div className="playground-code-shell"><div className="playground-code-toolbar"><span>{detectFenceLanguage(className)}</span><button type="button" className="playground-copy-btn" onClick={() => navigator.clipboard?.writeText(value)}>Copy</button></div><pre><code className={className}>{value}</code></pre></div>
}

function MarkdownBlock({ content }: { content: string }) {
  return <div className="playground-markdown"><ReactMarkdown components={{ pre: ({ children }) => <>{children}</>, code: ({ className, children }) => { const isBlock = Boolean(className); if (isBlock) return <CodeBlockShell className={className}>{children}</CodeBlockShell>; return <code>{children}</code> } }}>{content}</ReactMarkdown></div>
}

function ThinkingBlock({ content, closed }: { content: string; closed?: boolean }) {
  return <details className="thinking-block" open={!closed}><summary>{closed ? 'Thinking hidden' : 'Thinking...'}</summary><div className="thinking-block-body"><MarkdownBlock content={content.trim() || '_No reasoning text yet._'} /></div></details>
}

function completionMessages(messages: PlaygroundMessage[]) {
  return messages.map(({ role, content }) => ({ role, content }))
}

function attachmentsFromContent(content: string | PlaygroundContentPart[]) {
  if (typeof content === 'string') return []
  const files: PlaygroundAttachment[] = []
  content.forEach((part, index) => {
    if (part.type === 'image_url') files.push({ id: `image-${index}`, name: `Image ${index + 1}`, type: 'image', dataUrl: part.image_url.url, kind: 'image' })
    if (part.type === 'file') files.push({ id: `file-${index}`, name: part.file.name, type: part.file.mimeType, dataUrl: part.file.dataUrl, kind: 'file' })
  })
  return files
}

function MessageAttachments({ attachments }: { attachments: PlaygroundAttachment[] }) {
  return <div className="playground-message-attachments">{attachments.map((file) => <div className="playground-attachment playground-message-attachment" key={file.id}><div className="playground-attachment-preview">{file.kind === 'image' ? <img src={file.dataUrl} alt={file.name} /> : <span className="playground-attachment-file-icon">&#9733;</span>}</div><div className="playground-attachment-meta"><b>{file.name}</b><small>{file.kind === 'image' ? 'image preview' : file.type}</small></div></div>)}</div>
}

function MessageContent({ content, attachments = [] }: { content: string | PlaygroundContentPart[]; attachments?: PlaygroundAttachment[] }) {
  const normalized = typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => (part as { type: 'text'; text: string }).text).join('\n\n')
  const segments = useMemo(() => parseThinkingSegments(normalized), [normalized])
  const renderedAttachments = attachments.length ? attachments : attachmentsFromContent(content)
  return <div className="playground-rendered">{normalized.trim() ? segments.map((segment, index) => segment.type === 'thinking' ? <ThinkingBlock key={`thinking-${index}`} content={segment.content} closed={segment.closed} /> : <MarkdownBlock key={`markdown-${index}`} content={segment.content} />) : null}{renderedAttachments.length ? <MessageAttachments attachments={renderedAttachments} /> : null}</div>
}

function Playground({ models, userApiKey, error, setError }: { models: Model[]; userApiKey: string; error: string; setError: (value: string) => void }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('You are routed through RAZE. Be direct and useful.')
  const [result, setResult] = useState('No request sent yet.')
  const [messages, setMessages] = useState<PlaygroundMessage[]>([])
  const [attachments, setAttachments] = useState<PlaygroundAttachment[]>([])
  const [debugOpen, setDebugOpen] = useState(window.innerWidth > 900)
  const [pending, setPending] = useState(false)
  const model = models.find((item) => item.id === modelId) ?? models[0]
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const streamRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!model && models[0]) setModelId(models[0].id)
  }, [model, models])

  useEffect(() => {
    resizeComposer(composerRef.current)
  }, [prompt])

  useEffect(() => {
    if (!streamRef.current) return
    streamRef.current.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, attachments.length, pending])

  const requestPreview = model ? {
    model: model.id,
    messages: [{ role: 'system', content: systemPrompt }, ...completionMessages(messages), { role: 'user', content: prompt || '<prompt>' }],
    attachments: attachments.map((file) => ({ name: file.name, type: file.type })),
    stream: true,
  } : null

  const attachFiles = async (files: FileList | null) => {
    if (!files) return
    const picked = Array.from(files).slice(0, 4)
    const valid = picked.filter((file) => file.size <= PLAYGROUND_MAX_ATTACH_BYTES)
    if (valid.length < picked.length) setError('One or more files exceeded 4 MB and were skipped.')
    if (!valid.length) return

    try {
      const next = await Promise.all(valid.map((file) => new Promise<PlaygroundAttachment>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', dataUrl: String(reader.result), kind: file.type.startsWith('image/') ? 'image' : 'file' })
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
        reader.readAsDataURL(file)
      })))
      setAttachments((current) => [...current, ...next].slice(0, 4))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'attachment import failed')
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((file) => file.id !== id))
  }

  const buildUserContent = (text: string, files: PlaygroundAttachment[]): PlaygroundContentPart[] => {
    const trimmed = text.trim()
    const parts: PlaygroundContentPart[] = trimmed ? [{ type: 'text', text: trimmed }] : []
    for (const file of files) {
      if (file.kind === 'image') {
        parts.push({ type: 'image_url', image_url: { url: file.dataUrl } })
      } else {
        parts.push({ type: 'file', file: { name: file.name, mimeType: file.type, dataUrl: file.dataUrl } })
      }
    }
    return parts.length ? parts : [{ type: 'text', text: '' }]
  }

  const submit = async () => {
    if (!model) {
      setError('No route is configured yet.')
      return
    }
    if (!prompt.trim() && !attachments.length) return
    if (!userApiKey) {
      setError('Generate or paste a user API key in Dashboard before using the playground.')
      setResult('Missing bearer key. Open Dashboard and generate a user API key first.')
      return
    }

    setPending(true)
    setError('')
    setResult('sending request...')

    try {
      const trimmedPrompt = prompt.trim()
      const queuedAttachments = [...attachments]
      const userContent = buildUserContent(trimmedPrompt, queuedAttachments)
      const userMessage: PlaygroundMessage = { role: 'user', content: userContent, attachments: queuedAttachments }
      const outgoing = [...messages, userMessage]
      const apiMessages = completionMessages(outgoing)
      setMessages(outgoing)
      setPrompt('')
      setAttachments([])
      if (composerRef.current) {
        composerRef.current.value = ''
        resizeComposer(composerRef.current)
      }
      let streamedText = ''
      setMessages([...outgoing, { role: 'assistant', content: '' }])
      setResult('streaming response...')
      await sendChatCompletionStream({ model: model.id, messages: [{ role: 'system', content: systemPrompt }, ...apiMessages], stream: true }, (delta) => {
        streamedText += delta
        setResult(streamedText)
        setMessages([...outgoing, { role: 'assistant', content: streamedText }])
      })
      if (!streamedText.trim()) {
        streamedText = 'No assistant content returned.'
        setResult(streamedText)
        setMessages([...outgoing, { role: 'assistant', content: streamedText }])
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'request failed'
      setError(message)
      setResult(message)
    } finally {
      setPending(false)
    }
  }

  return <section className="playground-shell"><header className="playground-topbar"><div className="playground-topbar-left"><span className="playground-badge">Chat</span><div className="playground-title-group"><div className="playground-title-main">RAZE Conversation</div><div className="playground-title-sub">{model?.name || 'No route selected'}</div></div></div><div className="playground-topbar-right"><span className={`playground-status ${model?.status === 'Online' ? 'online' : ''}`}>{model?.status || 'No model'}</span><button className="playground-ghost" onClick={() => setDebugOpen((value) => !value)}>{debugOpen ? 'Hide Debug' : 'Safe Debug'}</button></div></header><div className="playground-workspace"><main className="playground-chat-panel"><div className="playground-config playground-config-framed"><div className="playground-field-row"><label className="playground-field-label">Route</label><select value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="playground-field-row"><label className="playground-field-label">System</label><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="System prompt" /></div>{error ? <div className="playground-alert">{error}</div> : null}</div><div ref={streamRef} className="playground-chat-stream">{messages.length ? messages.map((message, index) => <article key={index} className={`playground-message ${message.role}`}><span>{message.role}</span><MessageContent content={message.content} attachments={message.attachments} /></article>) : <div className="playground-empty"><div className="playground-empty-icon" aria-hidden="true">&#9670;</div><span>No messages yet.</span><small>Pick a route, attach images or files, and send a prompt through the protected router.</small></div>}</div><div className="playground-composer"><div className="playground-composer-box"><textarea ref={composerRef} value={prompt} onInput={(event) => resizeComposer(event.currentTarget)} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !pending) { event.preventDefault(); submit() } }} placeholder="Send a message through the selected route..." /><div className="playground-composer-actions"><label className="playground-icon-btn" title="Attach files">+<input type="file" multiple onChange={(event) => attachFiles(event.target.files)} /></label><button className="playground-icon-btn send" onClick={submit} disabled={pending}>{pending ? '...' : 'Send'}</button></div></div>{attachments.length ? <div className="playground-attachments">{attachments.map((file) => <div className="playground-attachment" key={file.id}><div className="playground-attachment-preview">{file.kind === 'image' ? <img src={file.dataUrl} alt={file.name} /> : <span className="playground-attachment-file-icon">&#9733;</span>}</div><div className="playground-attachment-meta"><b>{file.name}</b><small>{file.kind === 'image' ? 'image preview' : file.type}</small></div><button type="button" onClick={() => removeAttachment(file.id)}>x</button></div>)}</div> : null}<div className="playground-composer-hint"><span>{userApiKey ? 'Bearer key loaded from dashboard' : 'No bearer key loaded'}</span><span>{pending ? 'Sending...' : 'Enter to send  -  Shift+Enter for newline'}</span></div></div></main><aside className={`playground-debug-panel ${debugOpen ? '' : 'hidden'}`}><div className="playground-debug-header"><span>Safe Debug</span><span>{model?.id || 'no-model'}</span></div><div className="playground-debug-body"><div><div className="playground-debug-title">Request preview</div><pre className="playground-code-block">{JSON.stringify(requestPreview, null, 2)}</pre></div><div><div className="playground-debug-title">Response</div><pre className="playground-code-block response">{result}</pre></div></div></aside></div></section>
}

function Dashboard({ setView, openLogin, userApiKey, setUserApiKey, user, setUser, logout, openConfirm, rankingEnabled }: { setView: (view: View) => void; openLogin: () => void; userApiKey: string; setUserApiKey: (value: string) => void; user: UserProfile | null; setUser: (user: UserProfile) => void; logout: () => void; openConfirm: (title: string, body: string, onConfirm: () => void, confirmLabel?: string, tone?: 'default' | 'danger') => void; rankingEnabled: boolean }) {
  const [keyState, setKeyState] = useState('')
  const [avatarState, setAvatarState] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null)
  const [statsState, setStatsState] = useState('Sign in to sync live usage.')

  useEffect(() => {
    if (!user) {
      setDashboardStats(null)
      setStatsState('Sign in to sync live usage.')
      return
    }
    let cancelled = false
    setStatsState('syncing live usage...')
    fetchDashboardStats().then((stats) => {
      if (cancelled) return
      setDashboardStats(stats)
      setStatsState('usage synced')
    }).catch((error) => {
      if (cancelled) return
      setDashboardStats(null)
      setStatsState(error instanceof Error ? error.message : 'usage sync failed')
    })
    return () => { cancelled = true }
  }, [user?.id])

  const onAvatarFile = async (file: File) => {
    if (!user) return setAvatarState('Sign in with Google before uploading an avatar.')
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        setAvatarState('uploading avatar...')
        const result = await uploadAvatar(String(reader.result))
        setUser(result.user)
        setAvatarState('avatar updated')
      } catch (error) {
        setAvatarState(error instanceof Error ? error.message : 'avatar upload failed')
      }
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) await onAvatarFile(file)
  }

  const runGenerateKey = async (hasExisting: boolean) => {
    setKeyState(hasExisting ? 'replacing key...' : 'generating key...')
    try {
      const key = await createUserApiKey('Dashboard key')
      storeUserApiKey(key.key)
      setUserApiKey(key.key)
      setKeyVisible(true)
      setKeyState(hasExisting ? 'previous key deleted, new key generated' : 'key generated')
      try {
        setDashboardStats(await fetchDashboardStats())
        setStatsState('usage synced')
      } catch {
        setStatsState('key generated; usage sync pending')
      }
    } catch (error) {
      setKeyState(error instanceof Error ? error.message : 'key generation failed')
    }
  }

  const generateKey = async () => {
    if (!user || user.authMethod !== 'google' || !user.emailVerified) return setKeyState('Sign in with a verified Google account before generating an API key.')
    const hasExisting = Boolean(userApiKey)
    if (hasExisting) {
      openConfirm('Regenerate API key', 'Are you sure? The previous key will be deleted.', () => { void runGenerateKey(true) }, 'Regenerate key', 'danger')
      return
    }
    await runGenerateKey(false)
  }

  const copyUserKey = async () => {
    if (!userApiKey) return
    await navigator.clipboard?.writeText(userApiKey)
    setKeyState('key copied')
  }

  const rpdUsed = dashboardStats?.rpdUsed || 0
  const rpdLimit = dashboardStats?.rpdLimit || 0
  const rpdPercent = rpdLimit > 0 ? Math.min(100, Math.round((rpdUsed / rpdLimit) * 100)) : 0
  const dailyTokens = dashboardStats?.dailyTokens || 0
  const totalTokens = dashboardStats?.totalTokens || 0

  return <section className="view-shell dashboard-section"><div className="section-heading"><p className="eyebrow">dashboard</p><h2>Command center.</h2><p>Verified Google sessions can manage avatars, one protected RAZE API key, daily request usage, and live token totals.</p></div><div className="dashboard-grid"><article className="wide-panel dashboard-account-panel"><p className="eyebrow">account</p><h3>{user ? user.username : 'Sign in required'}</h3><p>{user ? user.email + ' - ' + (user.emailVerified ? 'verified Google account' : 'verification required') : 'Sign in with Google to unlock avatar storage, API key creation, and live usage widgets.'}</p><div className="dashboard-actions">{user ? <><button className="primary" onClick={logout}>Sign out</button><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button>{rankingEnabled && <button className="secondary" onClick={() => setView('Ranking')}>Model Ranking</button>}</> : <><button className="google-btn" onClick={openLogin}>Sign in with Google</button><button className="secondary" onClick={() => setView('Models')}>View Registry</button></>}</div></article><article className="dashboard-usage-panel"><span>RPD used</span><b>{formatCompactNumber(rpdUsed)} / {rpdLimit ? formatCompactNumber(rpdLimit) : '-'}</b><div className="dashboard-stat-meter"><i style={{ width: rpdPercent + '%' }} /></div><small>{statsState}</small></article><article className="dashboard-usage-panel token-widget"><span>Tokens today</span><b>{formatCompactNumber(dailyTokens)}</b><div className="token-widget-row"><span>Total tokens</span><strong>{formatCompactNumber(totalTokens)}</strong></div><small>compact daily + lifetime usage</small></article><article className="dashboard-usage-panel"><span>API key</span><b>{dashboardStats?.activeKeyId ? 'Active' : userApiKey ? 'Local key' : 'Missing'}</b><p>{dashboardStats ? 'RPM ' + formatCompactNumber(dashboardStats.rpmLimit) + ' / requests ' + formatCompactNumber(dashboardStats.requestCount) : 'Generate a key to enable routed API usage.'}</p></article><article className="wide-panel dashboard-avatar-panel"><p className="eyebrow">profile image</p><p>Drop a PNG, JPEG, WEBP, or GIF file under 750 KB. The image is stored in the backend database and served through your protected profile route.</p><div className={'avatar-dropzone ' + (user ? '' : 'disabled')} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}><div className="avatar-preview">{user?.avatarUrl ? <img src={user.avatarUrl} alt="Profile avatar" /> : <span>{user?.username?.slice(0, 1) || '?'}</span>}</div><div className="avatar-copy"><b>Drop avatar here</b><span>{user ? 'or use file picker' : 'sign in first'}</span></div><label className="secondary avatar-upload-label">Choose file<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!user} onChange={(event) => { const file = event.target.files?.[0]; if (file) onAvatarFile(file) }} /></label></div><small>{avatarState || 'No avatar uploaded yet.'}</small></article><article className="wide-panel dashboard-key-panel"><p className="eyebrow">api access</p><h3>{userApiKey ? 'RAZE key ready' : 'Create a user API key'}</h3><p>User keys are capped by the backend RPM/RPD/token guardrails and linked to your verified Google session.</p><div className="key-display"><code>{keyVisible && userApiKey ? userApiKey : maskApiKey(userApiKey)}</code><button className="secondary" onClick={() => setKeyVisible(!keyVisible)} disabled={!userApiKey}>{keyVisible ? 'Hide' : 'Reveal'}</button><button className="secondary" onClick={copyUserKey} disabled={!userApiKey}>Copy</button></div><div className="dashboard-actions"><button className="primary" onClick={generateKey}>{userApiKey ? 'Regenerate key' : 'Generate API key'}</button></div><small>{keyState || 'The full key is only shown in this browser after generation.'}</small></article></div></section>
}
function AdminPanel(props: { models: Model[]; adminConfig: AdminConfig; updateAdminConfig: (updater: (config: AdminConfig) => AdminConfig) => void; selectedModel: Model; selectedModelId: string; setSelectedModelId: (id: string) => void; adminSection: AdminSection; setAdminSection: (tab: AdminSection) => void; updateModel: (patch: Partial<Model>) => void; addModel: () => void; deleteModel: () => void; saveConfig: () => void; saveSecret: (name: string, value: string) => void; syncState: string; toggleCapability: (cap: Capability) => void; refreshAdmin: () => void; adminKey: string; openConfirm: (title: string, body: string, onConfirm: () => void, confirmLabel?: string, tone?: 'default' | 'danger') => void }) {
  const { models, adminConfig, updateAdminConfig, selectedModel: rawModel, selectedModelId, setSelectedModelId, adminSection, setAdminSection, updateModel, addModel, deleteModel, saveConfig, saveSecret, syncState, toggleCapability, refreshAdmin, adminKey, openConfirm } = props

  const selectedModel: Model = {
    ...rawModel,
    capabilities: Array.isArray(rawModel.capabilities) ? rawModel.capabilities : [],
    tags: Array.isArray(rawModel.tags) ? rawModel.tags : [],
    groups: Array.isArray(rawModel.groups) ? rawModel.groups : [],
    rpdExempt: rawModel.rpdExempt === true,
    providerConfig: {
      ...(rawModel.providerConfig || {}),
      provider: rawModel.providerConfig?.provider ?? 'OpenAI Compatible',
      modelId: rawModel.providerConfig?.modelId ?? '',
      openAIBaseUrl: rawModel.providerConfig?.openAIBaseUrl ?? '',
      anthropicEndpoint: rawModel.providerConfig?.anthropicEndpoint ?? '',
      apiKeyLabel: rawModel.providerConfig?.apiKeyLabel ?? 'RAZE_PROVIDER_KEY',
      cacheMode: rawModel.providerConfig?.cacheMode ?? 'Off',
      cacheTtlSeconds: rawModel.providerConfig?.cacheTtlSeconds ?? 300,
      cacheSystemPrompt: rawModel.providerConfig?.cacheSystemPrompt ?? true,
      cacheTools: rawModel.providerConfig?.cacheTools ?? false,
      cacheLargeContext: rawModel.providerConfig?.cacheLargeContext ?? true,
    },
  }

  const [aliasDraft, setAliasDraft] = useState((selectedModel.groups || []).join(', '))
  const [secretValue, setSecretValue] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [selectedIncidentCode, setSelectedIncidentCode] = useState('')
  const [incidentDetail, setIncidentDetail] = useState<IncidentDetail | null>(null)
  const [incidentState, setIncidentState] = useState('')
  const [verifiedEmailDraft, setVerifiedEmailDraft] = useState('')
  const [verificationState, setVerificationState] = useState('')
  const [rankingCategoryId, setRankingCategoryId] = useState(rankingVoteCategories[0].id)
  const [rankingBoostAmount, setRankingBoostAmount] = useState('10')
  const [rankingGroupNameDraft, setRankingGroupNameDraft] = useState('')
  const [rankingGroupLogoDraft, setRankingGroupLogoDraft] = useState('')
  const [adminActionState, setAdminActionState] = useState('')

  const storedIncidents = adminConfig.incidents || []
  const requestLogs = adminConfig.requestLogs || []
  const failedLogs = requestLogs.filter((log) => log.status >= 500 || log.incidentCode)
  // Synthesize incident cards for failed logs that have an incidentCode but whose incident
  // object was not persisted (race between scheduleBackground writes). This ensures the
  // widget always reflects every logged failure, not just persisted incident objects.
  const syntheticIncidents = failedLogs
    .filter((log) => log.incidentCode && !storedIncidents.some((inc) => inc.code === log.incidentCode))
    .map((log) => ({
      code: log.incidentCode as string,
      at: log.at,
      model: log.model,
      provider: 'Unknown provider',
      status: log.status,
      userKeyId: log.keyId,
      upstream: null,
    }))
  const incidentSummaries = [...storedIncidents, ...syntheticIncidents].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
  const availableTags = modelTagOptions(models)
  const selectedDescriptionColor = descriptionColorFromTags(selectedModel.tags)

  useEffect(() => {
    setAliasDraft(selectedModel.groups.join(', '))
    setSecretValue('')
    setTagDraft('')
  }, [selectedModel.id, selectedModel.groups])

  useEffect(() => {
    setSelectedIncidentCode('')
    setIncidentDetail(null)
    setIncidentState('')
  }, [adminSection, models.length])

  const updateProvider = (patch: Partial<Model['providerConfig']>) => updateModel({ providerConfig: { ...selectedModel.providerConfig, ...patch } })
  const updateTags = (tags: string[]) => updateModel({ tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))] })
  const addTag = (tag: string) => {
    const normalized = tag.trim()
    if (!normalized || selectedModel.tags.includes(normalized)) return
    updateTags([...selectedModel.tags, normalized])
    setTagDraft('')
  }
  const removeTag = (tag: string) => updateTags(selectedModel.tags.filter((item) => item !== tag))

  const openIncident = async (code: string) => {
    if (!code || !adminKey) return
    if (selectedIncidentCode === code && incidentDetail) {
      setSelectedIncidentCode('')
      setIncidentDetail(null)
      setIncidentState('')
      return
    }

    const localIncident = incidentSummaries.find((item) => item.code === code)
    const persistedIncident = storedIncidents.find((item) => item.code === code)
    setSelectedIncidentCode(code)
    setIncidentDetail(localIncident?.upstream ? { ...localIncident } : null)

    if (!persistedIncident) {
      setIncidentState('No upstream payload was persisted for this logged failure.')
      return
    }

    setIncidentState('loading incident context...')
    try {
      const detail = await fetchAdminIncident(adminKey, code)
      setIncidentDetail(detail)
      setIncidentState('')
    } catch (error) {
      setIncidentState(error instanceof Error ? error.message : 'failed to load incident context')
    }
  }

  const routeSummary = [
    ['Model ID', selectedModel.id],
    ['Provider model', selectedModel.providerConfig.modelId || 'not set'],
    ['Context limit', `${formatNumber(selectedModel.maxContext)} tokens`],
    ['RPD', selectedModel.rpdExempt ? 'unlimited' : 'limited'],
    ['Status', selectedModel.status],
  ]

  const aliases = normalizeAliasInput(aliasDraft)
  const totalRequests = requestLogs.length
  const totalUsers = (adminConfig.users || []).length
  const userKeys = adminConfig.userKeys || []
  const verifiedEmails = adminConfig.verifiedEmails || []
  const keyDefaults = {
    rpmLimit: Math.max(1, Math.floor(Number(adminConfig.keyDefaults?.rpmLimit || 60))),
    rpdLimit: Math.max(1, Math.floor(Number(adminConfig.keyDefaults?.rpdLimit || 1000))),
  }
  const totalKeys = userKeys.length
  const unlimitedModels = models.filter((model) => model.rpdExempt)
  const selectedIncidentLog = failedLogs.find((log) => log.incidentCode === selectedIncidentCode) || null

  const rankingCategoryLabel = rankingVoteCategories.find((category) => category.id === rankingCategoryId)?.label || 'Ranking'
  const selectedRankingVotes = rankingVoteCategories.reduce((total, category) => total + Number(adminConfig.rankingScores?.[category.id]?.[selectedModel.id] || 0), 0)
  const selectedRankingBoosts = rankingVoteCategories.reduce((total, category) => total + Number(adminConfig.rankingBoosts?.[category.id]?.[selectedModel.id] || 0), 0)
  const selectedModelUsage = adminConfig.usageCounters?.models?.[selectedModel.id]
  const rankingEnabled = adminConfig.rankingEnabled === true
  const rankingGroups = adminConfig.rankingGroups || []
  const selectedModelRankingGroup = rankingGroups.find((group) => (group.modelIds || []).includes(selectedModel.id))

  const updateRankingGroups = (updater: (groups: RankingGroup[]) => RankingGroup[]) => {
    updateAdminConfig((config) => ({ ...config, rankingGroups: updater(config.rankingGroups || []) }))
  }

  const addRankingGroup = () => {
    const name = rankingGroupNameDraft.trim()
    if (!name) {
      setAdminActionState('Enter a ranking group name first.')
      return
    }
    const logoUrl = rankingGroupLogoDraft.trim()
    updateRankingGroups((groups) => {
      const baseId = rankingGroupId(name)
      let id = baseId
      let suffix = 2
      while (groups.some((group) => group.id === id)) {
        id = baseId + '-' + suffix
        suffix += 1
      }
      return [{ id, name, logoUrl, modelIds: [] }, ...groups]
    })
    setRankingGroupNameDraft('')
    setRankingGroupLogoDraft('')
    setAdminActionState(name + ' ranking group added. Select models, then Save changes.')
  }

  const updateRankingGroup = (groupId: string, patch: Partial<RankingGroup>) => {
    updateRankingGroups((groups) => groups.map((group) => group.id === groupId ? { ...group, ...patch } : group))
  }

  const removeRankingGroup = (groupId: string) => {
    updateRankingGroups((groups) => groups.filter((group) => group.id !== groupId))
    setAdminActionState('Ranking group removed. Save changes to persist it.')
  }

  const toggleRankingGroupModel = (groupId: string, modelId: string) => {
    updateRankingGroups((groups) => groups.map((group) => {
      if (group.id !== groupId) return { ...group, modelIds: (group.modelIds || []).filter((id) => id !== modelId) }
      const current = new Set(group.modelIds || [])
      current.has(modelId) ? current.delete(modelId) : current.add(modelId)
      return { ...group, modelIds: [...current] }
    }))
  }

  const boostRanking = async () => {
    const amount = Math.floor(Number(rankingBoostAmount) || 0)
    if (!amount) {
      setAdminActionState('Enter a non-zero boost amount first.')
      return
    }
    try {
      const saved = await adminBoostRanking(adminKey, rankingCategoryId, selectedModel.id, amount)
      updateAdminConfig(() => saved)
      setAdminActionState(selectedModel.name + ' boosted by ' + amount + ' pts in ' + rankingCategoryLabel + '.')
    } catch (error) {
      setAdminActionState(error instanceof Error ? error.message : 'ranking boost failed')
    }
  }
  const addVerifiedEmail = () => {
    const email = verifiedEmailDraft.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setVerificationState('enter a valid email first')
      return
    }
    updateAdminConfig((config) => {
      const emails = [...new Set([...(config.verifiedEmails || []).map((item) => item.trim().toLowerCase()).filter(Boolean), email])]
      return { ...config, verifiedEmails: emails }
    })
    setVerifiedEmailDraft('')
    setVerificationState(email + ' added to verified allowlist')
  }

  const removeVerifiedEmail = (email: string) => {
    const normalized = email.trim().toLowerCase()
    updateAdminConfig((config) => ({ ...config, verifiedEmails: (config.verifiedEmails || []).filter((item) => item.trim().toLowerCase() !== normalized) }))
    setVerificationState(normalized + ' removed from allowlist')
  }

  const limitValue = (value: string) => Math.max(1, Math.floor(Number(value) || 1))

  const updateUserKeyLimit = (keyId: string, field: 'rpmLimit' | 'rpdLimit', value: string) => {
    const parsed = limitValue(value)
    updateAdminConfig((config) => ({ ...config, userKeys: (config.userKeys || []).map((key) => key.id === keyId ? { ...key, [field]: parsed } : key) }))
    setAdminActionState(`Manual ${field === 'rpmLimit' ? 'RPM' : 'RPD'} override set to ${parsed}. Save changes to persist it.`)
  }

  const applyKeyLimitToAll = (field: 'rpmLimit' | 'rpdLimit', value: string) => {
    const parsed = limitValue(value)
    updateAdminConfig((config) => ({
      ...config,
      keyDefaults: { ...(config.keyDefaults || {}), [field]: parsed },
      userKeys: (config.userKeys || []).map((key) => ({ ...key, [field]: parsed })),
    }))
    setAdminActionState(`Default ${field === 'rpmLimit' ? 'RPM' : 'RPD'} set to ${parsed} and applied to every existing key. New keys will use it after save.`)
  }

  const deleteAccount = (account: UserProfile) => {
    openConfirm('Delete account', `Delete ${account.email} and all of their API keys/sessions from the backend store?`, async () => {
      try {
        const saved = await deleteAdminUser(adminKey, account.id)
        updateAdminConfig(() => saved)
        setAdminActionState(`${account.email} deleted with their sessions and API keys.`)
      } catch (error) {
        setAdminActionState(error instanceof Error ? error.message : 'account delete failed')
      }
    }, 'Delete account', 'danger')
  }

  const deleteEveryAccount = () => {
    openConfirm('Delete every account', 'Delete every account, session, and user API key from the backend store? Models and provider secrets stay untouched.', async () => {
      try {
        const saved = await deleteAllAdminUsers(adminKey)
        updateAdminConfig(() => saved)
        setAdminActionState('Every account, session, and user API key was deleted.')
      } catch (error) {
        setAdminActionState(error instanceof Error ? error.message : 'bulk account delete failed')
      }
    }, 'Delete all accounts', 'danger')
  }

  const deleteKey = (key: UserKeyConfig) => {
    openConfirm('Delete API key', `Delete ${key.label || 'this API key'} from the backend store?`, async () => {
      try {
        const saved = await deleteAdminUserKey(adminKey, key.id)
        updateAdminConfig(() => saved)
        setAdminActionState(`${key.label || 'API key'} deleted.`)
      } catch (error) {
        setAdminActionState(error instanceof Error ? error.message : 'key delete failed')
      }
    }, 'Delete key', 'danger')
  }

  const deleteEveryKey = () => {
    openConfirm('Delete every user API key', 'Delete every user API key from the backend store while keeping accounts, models, and provider secrets?', async () => {
      try {
        const saved = await deleteAllAdminUserKeys(adminKey)
        updateAdminConfig(() => saved)
        setAdminActionState('Every user API key was deleted. Accounts were kept.')
      } catch (error) {
        setAdminActionState(error instanceof Error ? error.message : 'bulk key delete failed')
      }
    }, 'Delete all keys', 'danger')
  }

  return <section className="view-shell admin-section"><div className="section-heading split-heading"><div><p className="eyebrow">admin / protected</p><h2>Router control panel.</h2><p>Clean route setup for model ID, endpoint, context enforcement, aliases, and readable account activity.</p><p className="eyebrow">{syncState}</p></div><div className="admin-actions"><button className="secondary" onClick={refreshAdmin}>Refresh</button><button className="secondary" onClick={saveConfig}>Save changes</button><button className="primary" onClick={addModel}>Add route</button></div></div><div className="admin-shell"><aside className="admin-sidebar"><div className="admin-sidebar-block"><span className="admin-sidebar-label">Sections</span>{adminSections.map((section) => <button key={section} onClick={() => setAdminSection(section)} className={adminSection === section ? 'active' : ''}>{section}</button>)}</div><div className="admin-sidebar-block"><span className="admin-sidebar-label">Routes</span><select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>{models.map((model) => <option value={model.id} key={model.id}>{model.name} / {model.id}</option>)}</select><div className="admin-quick-switcher">{models.map((model) => <button key={model.id} type="button" className={model.id === selectedModelId ? 'active' : ''} onClick={() => setSelectedModelId(model.id)}><b>{model.name}</b><span>{model.id}</span></button>)}</div><div className="admin-route-pills">{routeSummary.map(([label, value]) => <div key={label} className="admin-route-pill"><span>{label}</span><b>{value}</b></div>)}</div></div></aside><div className="admin-main">{adminSection === 'Routes' ? <div className="admin-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">route basics</p><h3>{selectedModel.name || 'Untitled route'}</h3></div><span>public registry metadata</span></div><div className="admin-inline-actions"><button className="danger" onClick={deleteModel}>Delete route</button></div><div className="admin-form-grid"><label><span>Name</span><input value={selectedModel.name} onChange={(event) => updateModel({ name: event.target.value })} /></label><label><span>Model ID</span><input value={selectedModel.id} onChange={(event) => updateModel({ id: event.target.value })} /></label><label className="admin-field-span-2"><span>Description (Markdown supported)</span><textarea rows={5} value={selectedModel.description} onChange={(event) => updateModel({ description: event.target.value })} /></label><label><span>Description color</span><select value={selectedDescriptionColor} onChange={(event) => updateTags(updateDescriptionColorTags(selectedModel.tags, event.target.value as DescriptionColor))}>{descriptionColors.map((color) => <option key={color}>{color}</option>)}</select></label><label><span>Status</span><select value={selectedModel.status} onChange={(event) => updateModel({ status: event.target.value as ModelStatus })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label><span>Visibility</span><select value={selectedModel.visibility} onChange={(event) => updateModel({ visibility: event.target.value as Visibility })}>{visibilities.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>First token (s)</span><input type="number" value={selectedModel.firstToken} onChange={(event) => updateModel({ firstToken: Number(event.target.value) })} /></label><label><span>Context limit</span><input type="number" value={selectedModel.maxContext} onChange={(event) => updateModel({ maxContext: Number(event.target.value) })} /></label><label><span>Added</span><input value={selectedModel.added} onChange={(event) => updateModel({ added: event.target.value })} /></label><label><span>Sort priority</span><input type="number" value={selectedModel.sortPriority} onChange={(event) => updateModel({ sortPriority: Number(event.target.value) })} /></label><label className="admin-field-span-2"><span>Gradient</span><input value={selectedModel.gradient} onChange={(event) => updateModel({ gradient: event.target.value })} /></label><label className="admin-field-span-2"><span>Video URL</span><input value={selectedModel.videoUrl || ''} onChange={(event) => updateModel({ videoUrl: event.target.value })} /></label><label><span>Featured</span><select value={selectedModel.featured ? 'Yes' : 'No'} onChange={(event) => updateModel({ featured: event.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></label><div className="admin-field-span-2 admin-tag-picker"><span>Tags</span><select value="" onChange={(event) => addTag(event.target.value)}><option value="">Choose a tag...</option>{availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select><div className="admin-custom-tag"><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(tagDraft) } }} placeholder="Custom tag" /><button type="button" className="secondary" onClick={() => addTag(tagDraft)}>Add</button></div><div className="admin-tag-list">{selectedModel.tags.filter((tag) => !tag.startsWith('Color:')).length ? selectedModel.tags.filter((tag) => !tag.startsWith('Color:')).map((tag) => <button key={tag} type="button" className="admin-tag-chip" onClick={() => removeTag(tag)}><span>{tag}</span><b>remove</b></button>) : <small>No tags selected yet.</small>}</div></div></div></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">provider</p><h3>Routing target</h3></div><span>server-side only</span></div><div className="admin-form-grid"><label><span>Provider</span><select value={selectedModel.providerConfig.provider} onChange={(event) => updateProvider({ provider: event.target.value as ProviderType })}>{providerTypes.map((provider) => <option key={provider}>{provider}</option>)}</select></label><label><span>Provider model</span><input value={selectedModel.providerConfig.modelId} onChange={(event) => updateProvider({ modelId: event.target.value })} /></label><label><span>OpenAI base URL</span><input value={selectedModel.providerConfig.openAIBaseUrl || ''} onChange={(event) => updateProvider({ openAIBaseUrl: event.target.value })} /></label><label><span>Anthropic endpoint</span><input value={selectedModel.providerConfig.anthropicEndpoint || ''} onChange={(event) => updateProvider({ anthropicEndpoint: event.target.value })} /></label><label><span>Secret label</span><input value={selectedModel.providerConfig.apiKeyLabel} onChange={(event) => updateProvider({ apiKeyLabel: event.target.value })} /></label><label><span>Save secret value</span><input value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Paste secret or env label" /></label><button className="primary admin-button-inline" onClick={() => saveSecret(selectedModel.providerConfig.apiKeyLabel, secretValue)}>Save provider secret</button></div></section><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">capabilities</p><h3>Toggle support</h3></div><span>public card icons</span></div><div className="admin-toggle-grid">{capabilities.map((capability) => { const active = selectedModel.capabilities.includes(capability)
              return <button key={capability} className={`admin-toggle ${active ? 'active' : ''}`} onClick={() => toggleCapability(capability)}><b>{capability}</b><small>{capabilityDescriptions[capability]}</small></button>
            })}</div></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">cache</p><h3>Policy</h3></div><span>request optimization</span></div><div className="admin-form-grid"><label><span>Cache mode</span><select value={selectedModel.providerConfig.cacheMode} onChange={(event) => updateProvider({ cacheMode: event.target.value as CacheMode })}>{cacheModes.map((mode) => <option key={mode}>{mode}</option>)}</select></label><label><span>TTL seconds</span><input type="number" value={selectedModel.providerConfig.cacheTtlSeconds} onChange={(event) => updateProvider({ cacheTtlSeconds: Number(event.target.value) })} /></label><label><span>Cache system prompt</span><select value={selectedModel.providerConfig.cacheSystemPrompt ? 'Yes' : 'No'} onChange={(event) => updateProvider({ cacheSystemPrompt: event.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></label><label><span>Cache tools</span><select value={selectedModel.providerConfig.cacheTools ? 'Yes' : 'No'} onChange={(event) => updateProvider({ cacheTools: event.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></label><label><span>Cache large context</span><select value={selectedModel.providerConfig.cacheLargeContext ? 'Yes' : 'No'} onChange={(event) => updateProvider({ cacheLargeContext: event.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></label></div></section></div> : null}{adminSection === 'Aliases' ? <div className="admin-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">aliases</p><h3>Route groups and shortcuts</h3></div><span>{aliases.length} active</span></div><label><span>Comma-separated aliases</span><textarea rows={3} value={aliasDraft} onChange={(event) => setAliasDraft(event.target.value)} /></label><div className="admin-inline-actions"><button className="secondary" onClick={() => updateModel({ groups: aliases })}>Apply aliases</button></div><div className="alias-list">{aliases.length ? aliases.map((alias) => <div key={alias} className="alias-chip"><span>{alias}</span><b>{selectedModel.id}</b></div>) : <EmptyState title="No aliases yet" body="Add comma-separated aliases to create routing shortcuts." />}</div></section></div> : null}{adminSection === 'Accounts' ? (
  <div className="admin-grid">
    <section className="admin-card">
      <div className="admin-card-head"><div><p className="eyebrow">accounts</p><h3>Users</h3></div><span>{formatNumber(totalUsers)} total</span></div>
      <div className="admin-stats-grid"><div><span>Users</span><b>{formatNumber(totalUsers)}</b></div><div><span>Keys</span><b>{formatNumber(totalKeys)}</b></div><div><span>Requests</span><b>{formatNumber(totalRequests)}</b></div><div><span>Sync</span><b>{syncState}</b></div></div>
      <div className="admin-inline-actions"><button type="button" className="danger" onClick={deleteEveryAccount} disabled={!totalUsers && !totalKeys}>Delete every account + key</button></div>
      <small className="admin-inline-help">{adminActionState || 'Deletes call the live backend store, including Railway Redis/Postgres-backed data.'}</small>
    </section>
    <section className="admin-card admin-card-span-2">
      <div className="admin-card-head"><div><p className="eyebrow">user accounts</p><h3>Profile activity</h3></div><span>Google-backed sessions</span></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Auth</th><th>Key fingerprint</th><th>Requests</th><th>Actions</th></tr></thead><tbody>{(adminConfig.users || []).length ? (adminConfig.users || []).map((account) => {
        const activeKey = userKeys.find((key) => key.userId === account.id && key.active)
        const linkedKeys = userKeys.filter((key) => key.userId === account.id)
        const displayName = account.username || account.email || 'unknown'
        return <tr key={account.id}><td><div className="user-cell"><div className="user-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : <span>{displayName.slice(0, 1)}</span>}</div><div><b>{displayName}</b><small>{account.email}</small></div></div></td><td><b>{account.authMethod}</b><small>{account.emailVerified ? 'verified' : 'not verified'}</small></td><td><code>{fingerprint(activeKey?.key)}</code><small>{activeKey?.label || 'no active key'} / {linkedKeys.length} total keys</small></td><td><b>{formatNumber(activeKey?.requestCount || 0)}</b><small>last used {formatDate(activeKey?.lastUsedAt)}</small></td><td><button type="button" className="danger table-action" onClick={() => deleteAccount(account)}>Delete</button><small>removes sessions + keys</small></td></tr>
      }) : <tr><td colSpan={5}>No accounts yet.</td></tr>}</tbody></table></div>
    </section>
  </div>
) : null}{adminSection === 'Verification' ? (
  <div className="admin-grid">
    <section className="admin-card admin-card-span-2">
      <div className="admin-card-head"><div><p className="eyebrow">verified access</p><h3>Email allowlist</h3></div><span>{verifiedEmails.length} allowed</span></div>
      <p className="admin-copy">Only Google accounts whose email is listed here can finish registration and create user API keys. Save changes after editing this list.</p>
      <div className="verified-email-form"><input type="email" value={verifiedEmailDraft} onChange={(event) => setVerifiedEmailDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addVerifiedEmail() } }} placeholder="user@example.com" /><button className="primary" type="button" onClick={addVerifiedEmail}>Add email</button></div>
      <small className="admin-inline-help">{verificationState || 'Unlisted users receive: your email is not verified, please contact an admin.'}</small>
      <div className="verified-email-list">{verifiedEmails.length ? verifiedEmails.map((email) => <button key={email} type="button" className="verified-email-chip" onClick={() => removeVerifiedEmail(email)} aria-label={'Remove ' + email + ' from verified emails'}><span>{email}</span><b>remove</b></button>) : <EmptyState title="No verified emails" body="Add the first allowed email before inviting users." />}</div>
      <div className="admin-card-head"><div><p className="eyebrow">automation endpoint</p><h3>Discord bot contract</h3></div><span>POST /verified</span></div>
      <pre className="admin-code-sample">{'POST https://raze.up.railway.app/verified\nAuthorization: Bearer <MAIL-VERIFICATION-PASS>\nContent-Type: application/json\n\n{ "email": "user@example.com" }'}</pre>
    </section>
    <section className="admin-card admin-card-span-2">
      <div className="admin-card-head"><div><p className="eyebrow">api keys</p><h3>Defaults + bulk limits</h3></div><span>applies on save</span></div>
      <p className="admin-copy">Changing a default below applies that RPM/RPD to every current key and becomes the default for every newly generated key after Save changes. Manual per-key edits stay until you change the default again.</p>
      <div className="key-default-grid"><label><span>Default RPM for all keys</span><input type="number" min={1} value={keyDefaults.rpmLimit} onChange={(event) => applyKeyLimitToAll('rpmLimit', event.target.value)} /></label><label><span>Default RPD for all keys</span><input type="number" min={1} value={keyDefaults.rpdLimit} onChange={(event) => applyKeyLimitToAll('rpdLimit', event.target.value)} /></label></div>
      <div className="admin-inline-actions"><button type="button" className="danger" onClick={deleteEveryKey} disabled={!totalKeys}>Delete every user API key</button></div>
      <small className="admin-inline-help">{adminActionState || 'Use the table for one-key overrides, or change the defaults above to overwrite every key.'}</small>
    </section>
    <section className="admin-card admin-card-span-2">
      <div className="admin-card-head"><div><p className="eyebrow">api keys</p><h3>Per-key RPM / RPD limits</h3></div><span>{userKeys.length} keys</span></div>
      <div className="admin-table-wrap"><table className="admin-table key-limit-table"><thead><tr><th>Key</th><th>Owner</th><th>Status</th><th>RPM</th><th>RPD</th><th>Usage</th><th>Actions</th></tr></thead><tbody>{userKeys.length ? userKeys.map((key) => {
        const owner = (adminConfig.users || []).find((account) => account.id === key.userId)
        return <tr key={key.id}><td><code>{fingerprint(key.key)}</code><small>{key.label}</small></td><td><b>{owner?.username || 'unknown'}</b><small>{owner?.email || key.userId || 'no user link'}</small></td><td><b>{key.active ? 'active' : 'disabled'}</b><small>created {formatDate(key.createdAt)}</small></td><td><input type="number" min={1} value={key.rpmLimit ?? keyDefaults.rpmLimit} onChange={(event) => updateUserKeyLimit(key.id, 'rpmLimit', event.target.value)} /></td><td><input type="number" min={1} value={key.rpdLimit ?? keyDefaults.rpdLimit} onChange={(event) => updateUserKeyLimit(key.id, 'rpdLimit', event.target.value)} /></td><td><b>{formatNumber(key.requestCount || 0)}</b><small>last used {formatDate(key.lastUsedAt)}</small></td><td><button type="button" className="danger table-action" onClick={() => deleteKey(key)}>Delete</button><small>hard delete</small></td></tr>
      }) : <tr><td colSpan={7}>No user API keys yet.</td></tr>}</tbody></table></div>
    </section>
  </div>
) : null}{adminSection === 'Ranking' ? <div className="admin-grid ranking-admin-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">public ranking board</p><h3>{rankingEnabled ? 'Ranking visible' : 'Ranking hidden'}</h3></div><span>{rankingEnabled ? 'on' : 'off by default'}</span></div><p className="admin-copy">Enable this to show the public Model Ranking nav/page and rankings API. Disable it to hide the board while keeping scores, boosts, groups, logos, and usage counters stored.</p><button type="button" className={'admin-toggle admin-ranking-toggle ' + (rankingEnabled ? 'active' : '')} onClick={() => updateAdminConfig((config) => ({ ...config, rankingEnabled: !rankingEnabled }))}><b>{rankingEnabled ? 'Ranking board on' : 'Ranking board off'}</b><small>Save changes to publish this visibility setting.</small></button></section><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">ranking groups</p><h3>Logos for model families</h3></div><span>{rankingGroups.length} groups</span></div><p className="admin-copy">Create a family such as Claude, select its routes, and add an HTTPS logo URL. The ranking page uses that logo as the small model avatar.</p><div className="ranking-group-create"><input value={rankingGroupNameDraft} onChange={(event) => setRankingGroupNameDraft(event.target.value)} placeholder="Group name, e.g. Claude" /><input value={rankingGroupLogoDraft} onChange={(event) => setRankingGroupLogoDraft(event.target.value)} placeholder="https://.../claude-logo.png" /><button type="button" className="primary" onClick={addRankingGroup}>Add group</button></div><div className="ranking-group-list">{rankingGroups.length ? rankingGroups.map((group) => <article className="admin-ranking-group" key={group.id}><div className="ranking-group-head"><div className="ranking-group-avatar">{group.logoUrl ? <img src={group.logoUrl} alt={group.name + ' logo'} /> : <span>{initials(group.name)}</span>}</div><div><b>{group.name}</b><span>{group.modelIds.length} selected models</span></div><button type="button" className="danger table-action" onClick={() => removeRankingGroup(group.id)}>Remove</button></div><div className="admin-form-grid"><label><span>Group name</span><input value={group.name} onChange={(event) => updateRankingGroup(group.id, { name: event.target.value })} /></label><label><span>Logo URL</span><input value={group.logoUrl || ''} onChange={(event) => updateRankingGroup(group.id, { logoUrl: event.target.value })} /></label></div><div className="ranking-group-model-grid">{models.map((model) => { const active = (group.modelIds || []).includes(model.id); return <button key={model.id} type="button" className={'ranking-group-model ' + (active ? 'active' : '')} onClick={() => toggleRankingGroupModel(group.id, model.id)}><span><b>{model.name}</b><code>{model.id}</code></span>{active ? <Check size={16} /> : <ChevronRight size={16} />}</button> })}</div></article>) : <EmptyState title="No ranking groups" body="Add Claude, OpenAI, Gemini, or any custom model family logo." />}</div><small className="admin-inline-help">{selectedModelRankingGroup ? selectedModel.name + ' currently uses ' + selectedModelRankingGroup.name + ' logo.' : selectedModel.name + ' is not assigned to a ranking group yet.'}</small></section><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">manual ranking boost</p><h3>{selectedModel.name}</h3></div><span>server persisted</span></div><p className="admin-copy">Add admin boost points to a vote category without touching user cooldowns. Most Used Models stays request-based and is shown from real routed usage counters.</p><div className="admin-ranking-controls"><label><span>Vote category</span><select value={rankingCategoryId} onChange={(event) => setRankingCategoryId(event.target.value)}>{rankingVoteCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label><label><span>Boost points</span><input type="number" value={rankingBoostAmount} onChange={(event) => setRankingBoostAmount(event.target.value)} /></label><button type="button" className="primary" onClick={boostRanking}>Boost selected model</button></div><div className="admin-ranking-summary"><div><span>User votes</span><b>{formatCompactNumber(selectedRankingVotes)}</b></div><div><span>Admin boost</span><b>{formatCompactNumber(selectedRankingBoosts)}</b></div><div><span>Most Used req</span><b>{formatCompactNumber(selectedModelUsage?.requests || 0)}</b></div><div><span>Tokens routed</span><b>{formatCompactNumber(selectedModelUsage?.totalTokens || 0)}</b></div></div><small className="admin-inline-help">{adminActionState || 'Boosts are added on the live backend immediately; group edits persist on Save changes.'}</small></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">category snapshot</p><h3>{rankingCategoryLabel}</h3></div><span>selected route</span></div><div className="admin-security-list">{rankingVoteCategories.map((category) => { const votes = Number(adminConfig.rankingScores?.[category.id]?.[selectedModel.id] || 0); const boosts = Number(adminConfig.rankingBoosts?.[category.id]?.[selectedModel.id] || 0); return <p key={category.id}><b>{category.label}</b><span>{formatCompactNumber(votes + boosts)} pts ({formatCompactNumber(votes)} votes + {formatCompactNumber(boosts)} boost)</span></p> })}<p><b>Most Used Models</b><span>{formatCompactNumber(selectedModelUsage?.requests || 0)} real requests</span></p><p><b>Logo group</b><span>{selectedModelRankingGroup ? selectedModelRankingGroup.name : 'none'}</span></p></div></section></div> : null}{adminSection === 'Unlimited' ? <div className="admin-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">unlimited models</p><h3>RPD exemption</h3></div><span>{unlimitedModels.length} unlimited</span></div><p className="admin-copy">Only routes toggled here skip daily request counting. The backend resolves the trusted route first and ignores client-supplied unlimited flags, tags, aliases, or body fields.</p><div className="unlimited-selected"><div><b>{selectedModel.name}</b><code>{selectedModel.id}</code></div><button type="button" className={selectedModel.rpdExempt ? 'danger' : 'primary'} onClick={() => updateModel({ rpdExempt: !selectedModel.rpdExempt })}>{selectedModel.rpdExempt ? 'Disable unlimited RPD' : 'Make this route unlimited'}</button></div><div className="unlimited-route-list">{models.map((model) => <button key={model.id} type="button" className={'unlimited-route ' + (model.id === selectedModelId ? 'selected ' : '') + (model.rpdExempt ? 'active' : '')} onClick={() => setSelectedModelId(model.id)}><span><b>{model.name}</b><code>{model.id}</code></span><em>{model.rpdExempt ? 'Unlimited RPD' : 'Counts against RPD'}</em></button>)}</div></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">security note</p><h3>No request-body bypass</h3></div><span>server enforced</span></div><div className="admin-security-list"><p>RPM and token limits still apply to every route.</p><p>RPD exemption is saved in Admin model config and sanitized by the backend.</p><p>Provider model aliases must resolve uniquely; exact route IDs take priority.</p></div></section></div> : null}{adminSection === 'Request Logs' ? <div className="admin-grid request-log-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">logs</p><h3>Recent requests</h3></div><span>{formatNumber(requestLogs.length)} recorded</span></div><div className="request-log-list">{requestLogs.length ? requestLogs.map((log) => <article key={log.id} className={'request-log-card ' + (log.status >= 500 ? 'error' : log.status >= 400 ? 'warn' : '')}><div><span className="request-log-time">{formatDate(log.at)}</span><h4>{log.username || 'unknown user'}</h4><p>{log.email}</p></div><div><code>{log.model}</code><small>{log.streamed ? 'streamed' : 'standard'}{log.rpdExempt ? ' / unlimited RPD' : ''}</small></div><div><span className={'request-status status-' + (log.status >= 500 ? 'error' : log.status >= 400 ? 'warn' : 'ok')}>{log.status}</span><small>{log.incidentCode || 'no incident'}</small></div><div><b>{formatNumber(log.totalTokens)}</b><small>{formatNumber(log.inputTokens)} in / {formatNumber(log.outputTokens)} out</small></div></article>) : <EmptyState title="No request logs yet" body="Successful and failed routed requests will appear here." />}</div></section><section className="admin-card incident-panel"><div className="admin-card-head"><div><p className="eyebrow">alerts</p><h3>Incidents and alerts</h3></div><span>{incidentSummaries.length} total</span></div><div className="incident-list">{incidentSummaries.length ? incidentSummaries.map((incident) => { const expanded = selectedIncidentCode === incident.code; const logEntry = failedLogs.find((l) => l.incidentCode === incident.code) || null; const statusCode = incident.status ?? logEntry?.status ?? 0; const isSevere = statusCode >= 500; return <div key={incident.code} className={'incident-card ' + (expanded ? 'expanded ' : '') + (isSevere ? 'severe' : '')} onClick={() => openIncident(incident.code)}><div className="incident-card-head"><div className="incident-card-head-left"><span className={'incident-status-badge ' + (isSevere ? 'error' : 'warn')}>{statusCode || '5xx'}</span><div><div className="incident-card-code">{incident.code}</div><div className="incident-card-summary"><code>{incident.model || logEntry?.model || 'unknown route'}</code></div></div></div><div className="incident-card-head-right"><small className="incident-card-time">{formatDate(incident.at)}</small>{!expanded && <small className="incident-card-user">{logEntry?.username || logEntry?.email || ''}</small>}</div></div>{expanded && <><div className="incident-card-meta-row"><span className="incident-card-meta-item">{incident.provider || 'unknown provider'}</span><span className="incident-card-meta-item">{logEntry?.email || '-'}</span><span className="incident-card-meta-item tokens">{logEntry ? formatNumber(logEntry.inputTokens) + ' in / ' + formatNumber(logEntry.outputTokens) + ' out' : '-'}</span></div>{incidentState && <div className="incident-card-loading">{incidentState}</div>}{selectedIncidentLog ? <div className="incident-card-section"><div className="incident-card-label">Recorded request context</div><div className="incident-card-log-grid"><div><span>User</span><b>{selectedIncidentLog.username}</b><small>{selectedIncidentLog.email}</small></div><div><span>Tokens</span><b>{formatNumber(selectedIncidentLog.totalTokens)}</b><small>{formatNumber(selectedIncidentLog.inputTokens)} in / {formatNumber(selectedIncidentLog.outputTokens)} out</small></div><div><span>Status</span><b>{selectedIncidentLog.status}</b><small>{formatDate(selectedIncidentLog.at)}</small></div></div></div> : null}{incidentDetail?.upstream ? <div className="incident-card-section"><div className="incident-card-label">Upstream response</div><pre className="incident-card-upstream">{incidentDetail.upstream}</pre></div> : null}</>}</div> }) : <EmptyState title="No incidents yet" body="Provider-side failures and 5xx responses will appear here." />}</div></section></div> : null}</div></div></section>
}

function LockedAdmin({ openGate }: { openGate: () => void }) {
  return <section className="view-shell locked-admin"><p className="eyebrow">admin locked</p><h2>Protected control panel.</h2><p>Use the unlock button and your configured admin key for backend-backed management.</p><button className="primary" onClick={openGate}>Unlock Admin</button></section>
}

function Changelog() {
  return <section className="view-shell changelog-section"><div className="section-heading"><p className="eyebrow">release.history</p><h2>Production release history.</h2></div><div className="release-grid">{changelog.map((entry) => <article key={entry.version}><span>{entry.status}</span><h3>{entry.version}</h3><p>{entry.label}</p><ul>{entry.notes.map((note) => <li key={note}>{note}</li>)}</ul></article>)}</div></section>
}

function LoginModal({ close, user }: { close: () => void; user: UserProfile | null }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>x</button><p className="eyebrow">secure access</p><h2>{user ? 'Account connected' : 'Launch RAZE'}</h2><p>{user ? `Signed in as ${user.email}.` : 'Use Google OAuth to create a verified session and unlock protected API key generation.'}</p><button className="google-btn" onClick={startGoogleAuth}>{user ? 'Continue with Google' : 'Sign in with Google'}</button><small>Only verified Google accounts can create sessions and dashboard API keys.</small></div></div>
}

function AdminGate({ password, setPassword, close, submit }: { password: string; setPassword: (value: string) => void; close: () => void; submit: () => void }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>x</button><p className="eyebrow">admin gate</p><h2>Enter admin key</h2><p>This key is also used for protected backend admin routes.</p><div className="password-row"><input value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} autoFocus placeholder="Admin key" type="password" /><button onClick={submit}>Unlock</button></div><small>Set RAZE_ADMIN_KEY on Railway before production.</small></div></div>
}

function NoticeModal({ title, body, close }: { title: string; body: string; close: () => void }) {
  return <div className="modal-backdrop"><div className="login-modal confirm-modal"><button className="modal-close" onClick={close}>x</button><p className="eyebrow">access blocked</p><h2>{title}</h2><p>{body}</p><div className="confirm-modal-actions"><button className="primary" onClick={close}>Okay</button></div></div></div>
}

function ConfirmModal({ title, body, confirmLabel = 'Confirm', tone = 'default', close, confirm }: { title: string; body: string; confirmLabel?: string; tone?: 'default' | 'danger'; close: () => void; confirm: () => void }) {
  return <div className="modal-backdrop"><div className="login-modal confirm-modal"><button className="modal-close" onClick={close}>x</button><p className="eyebrow">confirm action</p><h2>{title}</h2><p>{body}</p><div className="confirm-modal-actions"><button className="secondary" onClick={close}>Cancel</button><button className={tone === 'danger' ? 'danger' : 'primary'} onClick={confirm}>{confirmLabel}</button></div></div></div>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{body}</p></div>
}

function toggleCapability(selectedModel: Model, updateModel: (patch: Partial<Model>) => void, capability: Capability) {
  const exists = selectedModel.capabilities.includes(capability)
  updateModel({ capabilities: exists ? selectedModel.capabilities.filter((item) => item !== capability) : [...selectedModel.capabilities, capability] })
}

export default App

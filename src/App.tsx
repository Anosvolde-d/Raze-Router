import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CacheMode, Capability, Model, ModelStatus, ProviderType, Visibility } from './types'
import { capabilityDescriptions, createBlankModel, seedModels } from './data/models'
import { changelog } from './data/changelog'
import { clearUserApiKey, clearUserSession, createUserApiKey, fetchAdminConfig, fetchPublicConfig, fetchUserSession, getStoredAdminKey, getUserApiKey, saveAdminConfig, saveProviderSecret, sendChatCompletion, setStoredAdminKey, startGoogleAuth, storeUserApiKey, uploadAvatar, verifyAdminKey, type UserProfile } from './api'

const views = ['Landing', 'Models', 'Playground', 'Dashboard', 'Changelog', 'Status'] as const
type View = (typeof views)[number] | 'Admin'

type AdminConfig = {
  users?: UserProfile[]
  userKeys?: Array<{ id: string; key?: string; userId?: string; label: string; active: boolean; createdAt: string; lastUsedAt: string | null; requestCount: number }>
  requestLogs?: Array<{ id: string; at: string; userId: string; email: string; username: string; model: string; status: number; inputTokens: number; outputTokens: number; totalTokens: number; incidentCode?: string }>
  incidents?: Array<{ code: string; at: string; model?: string; provider?: string; status?: number }>
}

type PlaygroundMessage = { role: 'user' | 'assistant'; content: string }
type PlaygroundAttachment = { name: string; type: string; dataUrl: string }
type PlaygroundResponse = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

type AdminSection = 'Routes' | 'Aliases' | 'Accounts' | 'Request Logs'

const filters = ['All', 'Online', 'Vision', 'Multimodal', 'Fast', 'Long Context', 'Experimental', 'New', 'Staff Picks']
const sortOptions = ['Priority', 'Fastest', 'Longest Context', 'Recently Added', 'Alphabetical']
const adminSections: AdminSection[] = ['Routes', 'Aliases', 'Accounts', 'Request Logs']
const capabilities: Capability[] = ['Vision', 'Audio', 'Video', 'Files', 'Tools', 'Reasoning', 'Streaming', 'Multimodal']
const providerTypes: ProviderType[] = ['OpenAI Compatible', 'Anthropic', 'Custom']
const cacheModes: CacheMode[] = ['Off', 'Anthropic Prompt Cache', 'OpenAI Compatible Cache', 'Hybrid']
const statuses: ModelStatus[] = ['Online', 'Offline', 'Coming Soon', 'Degraded']
const visibilities: Visibility[] = ['Public', 'Hidden', 'Staff Only', 'Preview']
const capabilityIcons: Record<Capability, string> = { Vision: 'visibility', Audio: 'graphic_eq', Video: 'movie', Files: 'draft', Tools: 'construction', Reasoning: 'psychology', Streaming: 'stream', Multimodal: 'hub' }

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

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function fingerprint(value?: string) {
  if (!value) return 'hidden'
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`
}

function normalizeAliasInput(value: string) {
  return splitList(value).map((alias) => alias.replace(/\s+/g, ' ').trim())
}

function App() {
  const [view, setView] = useState<View>('Landing')
  const [models, setModels] = useState<Model[]>(seedModels)
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('Priority')
  const [focusedCard, setFocusedCard] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [adminGateOpen, setAdminGateOpen] = useState(false)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [adminKey, setAdminKey] = useState(getStoredAdminKey)
  const [syncState, setSyncState] = useState('loading config')
  const [userApiKey, setUserApiKey] = useState('')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({})
  const [copied, setCopied] = useState('')
  const [adminSection, setAdminSection] = useState<AdminSection>('Routes')
  const [selectedModelId, setSelectedModelId] = useState(seedModels[0].id)
  const [playgroundError, setPlaygroundError] = useState('')

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
      setSyncState('backend connected')
    }).catch((error) => setSyncState(`local fallback: ${error.message}`))
  }, [])

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
      const saved = await saveAdminConfig(adminKey, { models })
      setModels(saved.models)
      setSyncState('config saved')
    } catch (error) {
      setSyncState(error instanceof Error ? error.message : 'save failed')
    }
  }

  const refreshAdmin = async () => {
    if (!adminKey) return
    const config = await fetchAdminConfig(adminKey)
    setModels(config.models)
    setAdminConfig({ users: config.users, userKeys: config.userKeys, requestLogs: config.requestLogs, incidents: config.incidents })
  }

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
        setAdminConfig({ users: config.users, userKeys: config.userKeys, requestLogs: config.requestLogs, incidents: config.incidents })
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

  return (
    <>
      <nav className="top-nav">
        <button className="wordmark ghost-button" onClick={() => setView('Landing')}>RAZE</button>
        <div className="nav-links">
          {views.map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item}</button>)}
        </div>
        <button className="profile-chip" onClick={() => setView('Dashboard')}>{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{user?.username?.slice(0, 1) || '?'}</span>}</button>
        <button className="launch-btn" onClick={() => setLoginOpen(true)}><span /> {user ? 'Account' : 'Launch'}</button>
      </nav>

      <main className="app-frame">
        {view === 'Landing' && <Landing setView={setView} openLogin={() => setLoginOpen(true)} models={featuredModels} focusedCard={focusedCard} setFocusedCard={setFocusedCard} copyId={copyId} copied={copied} stats={{ modelCount: visibleModels.length, authMode, adminUnlocked, cacheModes: cacheModes.length, providerCount: providerTypes.length, access: 'COMMUNITY' }} />}
        {view === 'Models' && <ModelsView filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} visibleModels={visibleModels} copyId={copyId} copied={copied} />}
        {view === 'Playground' && <Playground models={visibleModels} userApiKey={userApiKey} error={playgroundError} setError={setPlaygroundError} />}
        {view === 'Dashboard' && <Dashboard setView={setView} openLogin={() => setLoginOpen(true)} userApiKey={userApiKey} setUserApiKey={setUserApiKey} user={user} setUser={setUser} logout={logout} />}
        {view === 'Admin' && adminUnlocked && selectedModel && <AdminPanel models={models} adminConfig={adminConfig} selectedModel={selectedModel} selectedModelId={selectedModelId} setSelectedModelId={setSelectedModelId} adminSection={adminSection} setAdminSection={setAdminSection} updateModel={updateModel} addModel={addModel} saveConfig={saveConfig} saveSecret={saveSecret} syncState={syncState} toggleCapability={(cap) => toggleCapability(selectedModel, updateModel, cap)} refreshAdmin={refreshAdmin} />}
        {view === 'Admin' && adminUnlocked && !selectedModel && <div style={{ padding: '60px 5vw' }}><p style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.9rem' }}>Loading routes from backend…</p></div>}
        {view === 'Admin' && !adminUnlocked && <LockedAdmin openGate={() => setAdminGateOpen(true)} />}
        {view === 'Changelog' && <Changelog />}
        {view === 'Status' && <ControlCenter user={user} syncState={syncState} adminUnlocked={adminUnlocked} />}
      </main>

      {loginOpen && <LoginModal close={() => setLoginOpen(false)} user={user} />}
      {adminGateOpen && <AdminGate password={password} setPassword={setPassword} close={() => setAdminGateOpen(false)} submit={unlockAdmin} />}
    </>
  )
}

function Landing({ setView, openLogin, models, focusedCard, setFocusedCard, copyId, copied, stats }: { setView: (view: View) => void; openLogin: () => void; models: Model[]; focusedCard: string | null; setFocusedCard: (id: string | null) => void; copyId: (id: string) => void; copied: string; stats: { modelCount: number; authMode: string; adminUnlocked: boolean; cacheModes: number; providerCount: number; access: string } }) {
  return <section className="hero view-shell"><div className="hero-copy"><p className="eyebrow">secure ai router / admin-configured / community access</p><h1>RAZE Router, partially designed by me, then fully vibe coded 👍 cuz im lazy</h1><p className="hero-lede">RAZE is a production-ready AI router for model discovery, provider routing, exact-match caching, Google-authenticated access, and real-time streaming through a single OpenAI-style interface.</p><div className="hero-actions"><button className="primary" onClick={openLogin}>{'Sign in with Google'}</button><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button><button className="secondary" onClick={() => setView('Models')}>Explore Models</button></div></div><TerminalHero /><StatsBar stats={stats} /><section className="showcase-panel"><div><p className="eyebrow">model.cards</p><h2>Configured by admins, rendered live.</h2><p>Cards use admin-defined metadata and stay aligned with the public registry without exposing provider secrets or internal endpoints.</p></div><div className="showcase-grid">{models.length ? models.map((model) => <ModelCard key={model.id} model={model} mode="showcase" focused={focusedCard === model.id} dimmed={Boolean(focusedCard && focusedCard !== model.id)} onFocus={setFocusedCard} onCopy={copyId} copied={copied === model.id} />) : <EmptyState title="No featured routes" body="Feature a model in Admin to show it here." />}</div></section></section>
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

function VideoBackground({ url, title }: { url?: string; title: string }) {
  const [failed, setFailed] = useState(false)
  const src = normalizeMediaUrl(url)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <div className="video-fallback"><span>{failed ? 'video failed to load' : 'no video url'}</span></div>
  return <video key={src} src={src} title={`${title} background video`} autoPlay muted loop playsInline preload="metadata" onError={() => setFailed(true)} onStalled={() => setFailed(true)} />
}

function ModelCard({ model, mode, focused, dimmed, onFocus, onCopy, copied }: { model: Model; mode?: 'showcase'; focused?: boolean; dimmed?: boolean; onFocus?: (id: string | null) => void; onCopy: (id: string) => void; copied: boolean }) {
  return <article className={`model-card ${mode === 'showcase' ? 'portrait' : ''} ${dimmed ? 'dimmed' : ''} ${focused ? 'focused' : ''}`} onMouseEnter={() => onFocus?.(model.id)} onMouseLeave={() => onFocus?.(null)} style={{ '--card-gradient': model.gradient } as CSSProperties}><VideoBackground url={model.videoUrl} title={model.name} /><div className="card-shade" /><div className="model-card-content"><StatusPill status={model.status} /><div className="model-main"><h3>{model.name}</h3><button className="copy-id" onClick={() => onCopy(model.id)}>{copied ? 'copied' : model.id}</button><p>{model.description}</p></div><div className="model-meta"><span>{Math.round(model.maxContext / 1000)}K ctx</span><span>{model.providerConfig.provider}</span><span>{model.providerConfig.cacheMode}</span></div><div className="cap-icons">{model.capabilities.map((cap) => <CapabilityIcon key={cap} capability={cap} />)}</div></div></article>
}

function StatusPill({ status }: { status: ModelStatus }) {
  return <span className={`status status-${status.toLowerCase().replace(/ /g, '-')}`}>{status}</span>
}

function CapabilityIcon({ capability }: { capability: Capability }) {
  return <span className="cap-icon material-symbols-rounded" aria-label={capability}>{capabilityIcons[capability]}<em>{capability}: {capabilityDescriptions[capability]}</em></span>
}

function renderLiteMarkdown(value: string) {
  const escaped = value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char))
  return escaped.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />')
}

function Playground({ models, userApiKey, error, setError }: { models: Model[]; userApiKey: string; error: string; setError: (value: string) => void }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('You are routed through RAZE. Be direct and useful.')
  const [result, setResult] = useState('No request sent yet.')
  const [messages, setMessages] = useState<PlaygroundMessage[]>([])
  const [attachments, setAttachments] = useState<PlaygroundAttachment[]>([])
  const [debugOpen, setDebugOpen] = useState(true)
  const [pending, setPending] = useState(false)
  const model = models.find((item) => item.id === modelId) ?? models[0]

  useEffect(() => {
    if (!model && models[0]) setModelId(models[0].id)
  }, [model, models])

  const requestPreview = model ? {
    model: model.id,
    messages: [{ role: 'system', content: systemPrompt }, ...messages, { role: 'user', content: prompt || '<prompt>' }],
    attachments: attachments.map((file) => ({ name: file.name, type: file.type })),
    stream: false,
  } : null

  const attachFiles = async (files: FileList | null) => {
    if (!files) return
    const next = await Promise.all(Array.from(files).slice(0, 4).map((file) => new Promise<PlaygroundAttachment>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: String(reader.result) })
      reader.readAsDataURL(file)
    })))
    setAttachments(next)
  }

  const submit = async () => {
    if (!model) {
      setError('No route is configured yet.')
      return
    }
    if (!prompt.trim()) return
    if (!userApiKey) {
      setError('Generate or paste a user API key in Dashboard before using the playground.')
      setResult('Missing bearer key. Open Dashboard and generate a user API key first.')
      return
    }

    setPending(true)
    setError('')
    setResult('sending request...')

    try {
      const outgoing = [...messages, { role: 'user' as const, content: prompt }]
      setMessages(outgoing)
      const data = await sendChatCompletion({ model: model.id, messages: [{ role: 'system', content: systemPrompt }, ...outgoing], attachments, stream: false }) as PlaygroundResponse
      const raw = JSON.stringify(data, null, 2)
      setResult(raw)
      const assistantText = String(data?.choices?.[0]?.message?.content || 'No assistant content returned.')
      setMessages([...outgoing, { role: 'assistant', content: assistantText }])
      setPrompt('')
      setAttachments([])
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'request failed'
      setError(message)
      setResult(message)
    } finally {
      setPending(false)
    }
  }

  return <section className="playground-shell"><header className="playground-topbar"><div className="playground-topbar-left"><span className="playground-badge">Chat</span><div className="playground-title-group"><div className="playground-title-main">RAZE Conversation</div><div className="playground-title-sub">{model?.name || 'No route selected'}</div></div></div><div className="playground-topbar-right"><span className={`playground-status ${model?.status === 'Online' ? 'online' : ''}`}>{model?.status || 'No model'}</span><button className="playground-ghost" onClick={() => setDebugOpen((value) => !value)}>Safe Debug</button></div></header><div className="playground-workspace"><main className="playground-chat-panel"><div className="playground-config"><div className="playground-field-row"><label className="playground-field-label">Route</label><select value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="playground-field-row"><label className="playground-field-label">System</label><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="System prompt" /></div>{error ? <div className="playground-alert">{error}</div> : null}</div><div className="playground-chat-stream">{messages.length ? messages.map((message, index) => <article key={index} className={`playground-message ${message.role}`}><span>{message.role}</span><div dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(message.content) }} /></article>) : <div className="playground-empty"><div className="playground-empty-icon">□</div><span>No messages yet.</span></div>}</div><div className="playground-composer"><div className="playground-composer-box"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !pending) { event.preventDefault(); submit() } }} placeholder="Enter your message..." /><div className="playground-composer-actions"><label className="playground-icon-btn">+
            <input type="file" multiple onChange={(event) => attachFiles(event.target.files)} />
          </label><button className="playground-icon-btn send" onClick={submit} disabled={pending}>{pending ? '…' : '↑'}</button></div></div>{attachments.length ? <div className="playground-attachments">{attachments.map((file) => <span key={file.name}>{file.name}</span>)}</div> : null}<div className="playground-composer-hint"><span>{userApiKey ? 'Bearer key loaded from dashboard' : 'No bearer key loaded'}</span><span>{pending ? 'Sending…' : 'Enter to send · Shift+Enter for newline'}</span></div></div></main><aside className={`playground-debug-panel ${debugOpen ? '' : 'hidden'}`}><div className="playground-debug-header"><span>Safe Debug</span><span>{model?.id || 'no-model'}</span></div><div className="playground-debug-body"><div><div className="playground-debug-title">Request preview</div><pre className="playground-code-block">{JSON.stringify(requestPreview, null, 2)}</pre></div><div><div className="playground-debug-title">Response</div><pre className="playground-code-block">{result}</pre></div></div></aside></div></section>
}

function Dashboard({ setView, openLogin, userApiKey, setUserApiKey, user, setUser, logout }: { setView: (view: View) => void; openLogin: () => void; userApiKey: string; setUserApiKey: (value: string) => void; user: UserProfile | null; setUser: (user: UserProfile) => void; logout: () => void }) {
  const [keyState, setKeyState] = useState('')
  const [avatarState, setAvatarState] = useState('')

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

  const generateKey = async () => {
    if (!user || user.authMethod !== 'google' || !user.emailVerified) return setKeyState('Sign in with a verified Google account before generating an API key.')
    setKeyState('generating key...')
    try {
      const key = await createUserApiKey('Dashboard key')
      storeUserApiKey(key.key)
      setUserApiKey(key.key)
      setKeyState('key generated')
    } catch (error) {
      setKeyState(error instanceof Error ? error.message : 'key generation failed')
    }
  }

  return <section className="view-shell dashboard-section"><div className="section-heading"><p className="eyebrow">dashboard</p><h2>Command center.</h2><p>Verified Google sessions can manage avatars and generate protected RAZE API keys.</p></div><div className="dashboard-grid"><article className="wide-panel"><p className="eyebrow">account</p><h3>{user ? user.username : 'Sign in required'}</h3><p>{user ? `${user.email} · ${user.emailVerified ? 'verified Google account' : 'verification required'}` : 'Sign in with Google to unlock avatar storage and API key creation.'}</p><div className="dashboard-actions">{user ? <><button className="primary" onClick={logout}>Sign out</button><button className="secondary" onClick={() => setView('Playground')}>Open Playground</button></> : <><button className="google-btn" onClick={openLogin}>Sign in with Google</button><button className="secondary" onClick={() => setView('Models')}>View Registry</button></>}</div></article><article className="wide-panel"><span>Profile image</span><p>Drop a PNG, JPEG, WEBP, or GIF file under 750 KB. The image is stored in the backend database and served through your protected profile route.</p><div className={`avatar-dropzone ${user ? '' : 'disabled'}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}><div className="avatar-preview">{user?.avatarUrl ? <img src={user.avatarUrl} alt="Profile avatar" /> : <span>{user?.username?.slice(0, 1) || '?'}</span>}</div><div className="avatar-copy"><b>Drop avatar here</b><span>{user ? 'or use file picker' : 'sign in first'}</span></div><label className="secondary avatar-upload-label">Choose file<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!user} onChange={(event) => { const file = event.target.files?.[0]; if (file) onAvatarFile(file) }} /></label></div><small>{avatarState || 'No avatar uploaded yet.'}</small></article><article className="wide-panel"><span>Your API key</span><p>Use this as <code>Authorization: Bearer YOUR_KEY</code> with the OpenAI-compatible router.</p><div className="dashboard-actions"><button className="primary" onClick={generateKey}>Generate key</button>{userApiKey ? <button className="secondary" onClick={() => navigator.clipboard?.writeText(userApiKey)}>Copy key</button> : null}</div><pre>{userApiKey || 'No key generated yet.'}</pre><small>{keyState || 'Keys are only shown once after generation.'}</small></article></div></section>
}

function AdminPanel(props: { models: Model[]; adminConfig: AdminConfig; selectedModel: Model; selectedModelId: string; setSelectedModelId: (id: string) => void; adminSection: AdminSection; setAdminSection: (tab: AdminSection) => void; updateModel: (patch: Partial<Model>) => void; addModel: () => void; saveConfig: () => void; saveSecret: (name: string, value: string) => void; syncState: string; toggleCapability: (cap: Capability) => void; refreshAdmin: () => void }) {
  const { models, adminConfig, selectedModel, selectedModelId, setSelectedModelId, adminSection, setAdminSection, updateModel, addModel, saveConfig, saveSecret, syncState, toggleCapability, refreshAdmin } = props
  const [aliasDraft, setAliasDraft] = useState(selectedModel.groups.join(', '))
  const [secretValue, setSecretValue] = useState('')

  useEffect(() => {
    setAliasDraft(selectedModel.groups.join(', '))
    setSecretValue('')
  }, [selectedModel.id, selectedModel.groups])

  const updateProvider = (patch: Partial<Model['providerConfig']>) => updateModel({ providerConfig: { ...selectedModel.providerConfig, ...patch } })

  const routeSummary = [
    ['Model ID', selectedModel.id],
    ['Provider model', selectedModel.providerConfig.modelId || 'not set'],
    ['Context limit', `${formatNumber(selectedModel.maxContext)} tokens`],
    ['Status', selectedModel.status],
  ]

  const aliases = normalizeAliasInput(aliasDraft)
  const totalRequests = (adminConfig.requestLogs || []).length
  const totalUsers = (adminConfig.users || []).length
  const totalKeys = (adminConfig.userKeys || []).length

  return <section className="view-shell admin-section"><div className="section-heading split-heading"><div><p className="eyebrow">admin / protected</p><h2>Router control panel.</h2><p>Clean route setup for model ID, endpoint, context enforcement, aliases, and readable account activity.</p><p className="eyebrow">{syncState}</p></div><div className="admin-actions"><button className="secondary" onClick={refreshAdmin}>Refresh</button><button className="secondary" onClick={saveConfig}>Save changes</button><button className="primary" onClick={addModel}>Add route</button></div></div><div className="admin-shell"><aside className="admin-sidebar"><div className="admin-sidebar-block"><span className="admin-sidebar-label">Sections</span>{adminSections.map((section) => <button key={section} onClick={() => setAdminSection(section)} className={adminSection === section ? 'active' : ''}>{section}</button>)}</div><div className="admin-sidebar-block"><span className="admin-sidebar-label">Routes</span><select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>{models.map((model) => <option value={model.id} key={model.id}>{model.name} / {model.id}</option>)}</select><div className="admin-route-pills">{routeSummary.map(([label, value]) => <div key={label} className="admin-route-pill"><span>{label}</span><b>{value}</b></div>)}</div></div></aside><div className="admin-main">{adminSection === 'Routes' ? <div className="admin-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">route basics</p><h3>{selectedModel.name || 'Untitled route'}</h3></div><span>public registry metadata</span></div><div className="admin-form-grid"><label>Model name<input value={selectedModel.name} onChange={(event) => updateModel({ name: event.target.value })} placeholder="GPT-4 Turbo" /></label><label>Model ID<input value={selectedModel.id} onChange={(event) => updateModel({ id: event.target.value })} placeholder="gpt-4-turbo" /></label><label className="admin-field-span-2">Description<textarea value={selectedModel.description} onChange={(event) => updateModel({ description: event.target.value })} placeholder="Short route description" /></label><label>Max context<input type="number" value={selectedModel.maxContext} onChange={(event) => updateModel({ maxContext: Number(event.target.value) || 0 })} placeholder="128000" /></label><label>First token latency<input type="number" value={selectedModel.firstToken ?? 0} onChange={(event) => updateModel({ firstToken: Number(event.target.value) || 0 })} placeholder="15" /></label><label>Status<select value={selectedModel.status} onChange={(event) => updateModel({ status: event.target.value as ModelStatus })}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><label>Visibility<select value={selectedModel.visibility} onChange={(event) => updateModel({ visibility: event.target.value as Visibility })}>{visibilities.map((item) => <option key={item}>{item}</option>)}</select></label><label>Sort priority<input type="number" value={selectedModel.sortPriority} onChange={(event) => updateModel({ sortPriority: Number(event.target.value) || 0 })} /></label><label>Popularity<input type="number" value={selectedModel.popularity} onChange={(event) => updateModel({ popularity: Number(event.target.value) || 0 })} /></label><label>Added date<input value={selectedModel.added} onChange={(event) => updateModel({ added: event.target.value })} placeholder="2026-04-01" /></label><label>Gradient<input value={selectedModel.gradient} onChange={(event) => updateModel({ gradient: event.target.value })} placeholder="linear-gradient(...)" /></label><label>Featured<select value={String(selectedModel.featured)} onChange={(event) => updateModel({ featured: event.target.value === 'true' })}><option value="true">Featured</option><option value="false">Not featured</option></select></label><label>Launch available<select value={String(selectedModel.launchAvailable)} onChange={(event) => updateModel({ launchAvailable: event.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></label><label className="admin-field-span-2">Hover description<textarea value={selectedModel.hoverDescription} onChange={(event) => updateModel({ hoverDescription: event.target.value })} placeholder="Extra hover details" /></label><label className="admin-field-span-2">Registry tags<input value={selectedModel.tags.join(', ')} onChange={(event) => updateModel({ tags: splitList(event.target.value) })} placeholder="fast, long context, staff picks" /></label></div></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">endpoint</p><h3>Provider routing</h3></div><span>core request settings</span></div><div className="admin-form-grid"><label>Provider type<select value={selectedModel.providerConfig.provider} onChange={(event) => updateProvider({ provider: event.target.value as ProviderType })}>{providerTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Provider model ID<input value={selectedModel.providerConfig.modelId} onChange={(event) => updateProvider({ modelId: event.target.value })} placeholder="gpt-4-turbo-2024-04-09" /></label><label className="admin-field-span-2">OpenAI-compatible endpoint<input value={selectedModel.providerConfig.openAIBaseUrl} onChange={(event) => updateProvider({ openAIBaseUrl: event.target.value })} placeholder="https://provider.example/v1" /></label><label className="admin-field-span-2">Anthropic endpoint<input value={selectedModel.providerConfig.anthropicEndpoint} onChange={(event) => updateProvider({ anthropicEndpoint: event.target.value })} placeholder="https://api.anthropic.com/v1/messages" /></label><label>Secret env var<label className="admin-inline-help">Server-side key reference only</label><input value={looksLikeRawSecret(selectedModel.providerConfig.apiKeyLabel) ? safeSecretName(selectedModel) : selectedModel.providerConfig.apiKeyLabel} onChange={(event) => updateProvider({ apiKeyLabel: event.target.value })} placeholder="RAZE_PROVIDER_KEY" /></label><label>Provider API key<label className="admin-inline-help">Paste to save server-side</label><input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Paste provider key here" /></label><button type="button" className="secondary admin-button-inline" disabled={!secretValue.trim()} onClick={() => { saveSecret(selectedModel.providerConfig.apiKeyLabel, secretValue); setSecretValue('') }}>Save provider key</button></div></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">enforcement</p><h3>Context and cache</h3></div><span>runtime behavior</span></div><div className="admin-form-grid"><label>Context window enforcement<select value={String(selectedModel.launchAvailable)} onChange={(event) => updateModel({ launchAvailable: event.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></label><label>Cache mode<select value={selectedModel.providerConfig.cacheMode} onChange={(event) => updateProvider({ cacheMode: event.target.value as CacheMode })}>{cacheModes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Cache TTL seconds<input type="number" value={selectedModel.providerConfig.cacheTtlSeconds} onChange={(event) => updateProvider({ cacheTtlSeconds: Number(event.target.value) || 0 })} /></label><label>Large-context cache<select value={String(selectedModel.providerConfig.cacheLargeContext)} onChange={(event) => updateProvider({ cacheLargeContext: event.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></label><label>System prompt cache<select value={String(selectedModel.providerConfig.cacheSystemPrompt)} onChange={(event) => updateProvider({ cacheSystemPrompt: event.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></label><label>Tool cache<select value={String(selectedModel.providerConfig.cacheTools)} onChange={(event) => updateProvider({ cacheTools: event.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></label></div></section><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">capabilities</p><h3>Published feature flags</h3></div><span>customer-facing card badges</span></div><div className="admin-toggle-grid">{capabilities.map((capability) => <button key={capability} type="button" className={`admin-toggle ${selectedModel.capabilities.includes(capability) ? 'active' : ''}`} onClick={() => toggleCapability(capability)}>{capability}<small>{capabilityDescriptions[capability]}</small></button>)}</div></section></div> : null}{adminSection === 'Aliases' ? <div className="admin-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">alias management</p><h3>Map friendly names to the routed model</h3></div><span>stored in route groups</span></div><p className="admin-copy">Use comma-separated aliases. Example: <code>gpt-4-turbo, gpt-4-turbo-latest, gpt4-turbo</code>. These aliases currently persist through the route's <code>groups</code> field so you can save them immediately without backend schema changes.</p><label>Aliases<input value={aliasDraft} onChange={(event) => setAliasDraft(event.target.value)} placeholder="gpt-4-turbo, gpt-4-turbo-latest" /></label><div className="admin-inline-actions"><button className="primary" onClick={() => updateModel({ groups: aliases })}>Apply aliases</button><button className="secondary" onClick={() => setAliasDraft(selectedModel.groups.join(', '))}>Reset</button></div><div className="alias-list">{aliases.length ? aliases.map((alias) => <div key={alias} className="alias-chip"><span>{alias}</span><b>{selectedModel.providerConfig.modelId || selectedModel.id}</b></div>) : <EmptyState title="No aliases yet" body="Add public aliases that should resolve to this routed provider model." />}</div></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">target</p><h3>Current resolution</h3></div><span>what aliases point to</span></div><div className="admin-stats-grid"><div><span>Public route ID</span><b>{selectedModel.id}</b></div><div><span>Provider model ID</span><b>{selectedModel.providerConfig.modelId || 'not set'}</b></div><div><span>Endpoint</span><b>{selectedModel.providerConfig.openAIBaseUrl || selectedModel.providerConfig.anthropicEndpoint || 'not set'}</b></div><div><span>Visibility</span><b>{selectedModel.visibility}</b></div></div></section></div> : null}{adminSection === 'Accounts' ? <div className="admin-grid"><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">overview</p><h3>Accounts and keys</h3></div><span>readable activity</span></div><div className="admin-stats-grid"><div><span>Users</span><b>{formatNumber(totalUsers)}</b></div><div><span>API keys</span><b>{formatNumber(totalKeys)}</b></div><div><span>Requests logged</span><b>{formatNumber(totalRequests)}</b></div><div><span>Incidents</span><b>{formatNumber((adminConfig.incidents || []).length)}</b></div></div></section><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">users</p><h3>Google-authenticated accounts</h3></div><span>clean registry view</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Email</th><th>Status</th><th>Created</th></tr></thead><tbody>{(adminConfig.users || []).map((account) => <tr key={account.id}><td><div className="user-cell"><span className="user-avatar">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : account.username.slice(0, 1)}</span><div><b>{account.username}</b><small>{account.id}</small></div></div></td><td>{account.email}</td><td>{account.banned ? 'Banned' : account.emailVerified ? 'Verified' : 'Pending'}</td><td>{formatDate(account.createdAt)}</td></tr>)}</tbody></table>{!(adminConfig.users || []).length ? <EmptyState title="No accounts yet" body="User accounts will appear here after Google sign-in." /> : null}</div></section><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">api keys</p><h3>Key inventory</h3></div><span>readable fingerprints</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Label</th><th>Fingerprint</th><th>Status</th><th>Requests</th><th>Last used</th></tr></thead><tbody>{(adminConfig.userKeys || []).map((key) => <tr key={key.id}><td><b>{key.label}</b><small>{key.id}</small></td><td><code>{fingerprint(key.key)}</code></td><td>{key.active ? 'Active' : 'Revoked'}</td><td>{formatNumber(key.requestCount)}</td><td>{formatDate(key.lastUsedAt)}</td></tr>)}</tbody></table>{!(adminConfig.userKeys || []).length ? <EmptyState title="No keys yet" body="Generated user keys will appear here." /> : null}</div></section></div> : null}{adminSection === 'Request Logs' ? <div className="admin-grid"><section className="admin-card admin-card-span-2"><div className="admin-card-head"><div><p className="eyebrow">request logs</p><h3>Recent playground and API traffic</h3></div><span>status, tokens, incidents</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Time</th><th>User</th><th>Model</th><th>Status</th><th>Tokens</th><th>Incident</th></tr></thead><tbody>{(adminConfig.requestLogs || []).map((log) => <tr key={log.id}><td>{formatDate(log.at)}</td><td><b>{log.username}</b><small>{log.email}</small></td><td>{log.model}</td><td>{log.status}</td><td>{formatNumber(log.totalTokens)}</td><td>{log.incidentCode || '—'}</td></tr>)}</tbody></table>{!(adminConfig.requestLogs || []).length ? <EmptyState title="No request logs yet" body="Requests will show here once traffic hits the router." /> : null}</div></section><section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">incidents</p><h3>Router alerts</h3></div><span>upstream failures</span></div><div className="incident-list">{(adminConfig.incidents || []).map((incident) => <div key={incident.code} className="incident-card"><b>{incident.code}</b><span>{incident.model || 'unknown model'}</span><small>{incident.status ?? 'n/a'} · {formatDate(incident.at)}</small></div>)}</div>{!(adminConfig.incidents || []).length ? <EmptyState title="No incidents" body="Upstream provider errors will appear here." /> : null}</section></div> : null}</div></div></section>
}

function LockedAdmin({ openGate }: { openGate: () => void }) {
  return <section className="view-shell locked-admin"><p className="eyebrow">admin locked</p><h2>Protected control panel.</h2><p>Use the unlock button and your configured admin key for backend-backed management.</p><button className="primary" onClick={openGate}>Unlock Admin</button></section>
}

function ControlCenter({ user, syncState, adminUnlocked }: { user: UserProfile | null; syncState: string; adminUnlocked: boolean }) {
  const items = [
    user ? `active user session / ${user.email}` : 'no active user session',
    `config sync / ${syncState}`,
    `admin panel / ${adminUnlocked ? 'unlocked' : 'locked'}`,
    'protected key generation / google verified only',
    'streaming, caching, rate limiting, and observability enabled'
  ]
  return <section className="view-shell control-section"><div className="status-panel"><p>RAZE://STATUS</p>{items.map((item) => <span key={item}>{item}</span>)}<b>PRODUCTION STATE: READY</b></div><div className="faq-list">{['OpenAI-compatible routing surface', 'Google-authenticated sessions', 'Railway-ready deployment'].map((item) => <div key={item} className="faq-item"><b>{item}</b><span>RAZE routes requests through a protected backend, keeps provider secrets server-side, and exposes a single standardized API surface.</span></div>)}</div></section>
}

function Changelog() {
  return <section className="view-shell changelog-section"><div className="section-heading"><p className="eyebrow">release.history</p><h2>Production release history.</h2></div><div className="release-grid">{changelog.map((entry) => <article key={entry.version}><span>{entry.status}</span><h3>{entry.version}</h3><p>{entry.label}</p><ul>{entry.notes.map((note) => <li key={note}>{note}</li>)}</ul></article>)}</div></section>
}

function LoginModal({ close, user }: { close: () => void; user: UserProfile | null }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">secure access</p><h2>{user ? 'Account connected' : 'Launch RAZE'}</h2><p>{user ? `Signed in as ${user.email}.` : 'Use Google OAuth to create a verified session and unlock protected API key generation.'}</p><button className="google-btn" onClick={startGoogleAuth}>{user ? 'Continue with Google' : 'Sign in with Google'}</button><small>Only verified Google accounts can create sessions and dashboard API keys.</small></div></div>
}

function AdminGate({ password, setPassword, close, submit }: { password: string; setPassword: (value: string) => void; close: () => void; submit: () => void }) {
  return <div className="modal-backdrop"><div className="login-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">admin gate</p><h2>Enter admin key</h2><p>This key is also used for protected backend admin routes.</p><div className="password-row"><input value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} autoFocus placeholder="Admin key" type="password" /><button onClick={submit}>Unlock</button></div><small>Set RAZE_ADMIN_KEY on Railway before production.</small></div></div>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{body}</p></div>
}

function toggleCapability(selectedModel: Model, updateModel: (patch: Partial<Model>) => void, capability: Capability) {
  const exists = selectedModel.capabilities.includes(capability)
  updateModel({ capabilities: exists ? selectedModel.capabilities.filter((item) => item !== capability) : [...selectedModel.capabilities, capability] })
}

export default App
